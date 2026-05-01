"""JobSpy scraper — pulls from LinkedIn and Indeed using preferences."""

from datetime import UTC, datetime

from jobspy import scrape_jobs
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()

# Map remote_preference to JobSpy is_remote flag
REMOTE_MAP = {
    "remote_first": True,
    "remote": True,
    "hybrid": None,  # Don't filter
    "on_site": False,
    "any": None,
}

# Valid JobSpy country strings (+ common aliases on the left)
_COUNTRY_ALIASES: dict[str, str] = {
    "us": "usa",
    "united states": "usa",
    "uk": "united kingdom",
    "uae": "united arab emirates",
}

_VALID_COUNTRIES = {
    "argentina", "australia", "austria", "bahrain", "bangladesh", "belgium",
    "bulgaria", "brazil", "canada", "chile", "china", "colombia", "costa rica",
    "croatia", "cyprus", "czech republic", "czechia", "denmark", "ecuador",
    "egypt", "estonia", "finland", "france", "germany", "greece", "hong kong",
    "hungary", "india", "indonesia", "ireland", "israel", "italy", "japan",
    "kuwait", "latvia", "lithuania", "luxembourg", "malaysia", "malta",
    "mexico", "morocco", "netherlands", "new zealand", "nigeria", "norway",
    "oman", "pakistan", "panama", "peru", "philippines", "poland", "portugal",
    "qatar", "romania", "saudi arabia", "singapore", "slovakia", "slovenia",
    "south africa", "south korea", "spain", "sweden", "switzerland", "taiwan",
    "thailand", "türkiye", "turkey", "ukraine", "united arab emirates",
    "united kingdom", "usa", "uruguay", "venezuela", "vietnam",
}

# Locations that aren't countries — skip them (handled by is_remote flag)
_SKIP_LOCATIONS = {"remote", "anywhere", "worldwide"}

# Cap searches to avoid combinatorial explosion with many locations
_MAX_SEARCH_LOCATIONS = 5


def _normalize_locations(locations: list[str]) -> list[str]:
    """Filter and normalize user locations to valid JobSpy country strings.

    Caps at _MAX_SEARCH_LOCATIONS to keep scrape times reasonable.
    Remote jobs are found via the is_remote flag, not by searching every country.
    """
    result: list[str] = []
    seen: set[str] = set()
    for loc in locations:
        low = loc.lower().strip()
        if low in _SKIP_LOCATIONS:
            continue
        normalized = _COUNTRY_ALIASES.get(low, low)
        if normalized in _VALID_COUNTRIES and normalized not in seen:
            result.append(normalized)
            seen.add(normalized)
        if len(result) >= _MAX_SEARCH_LOCATIONS:
            break
    return result


def scrape_jobspy() -> tuple[int, int, int]:
    """Scrape jobs via JobSpy using preferences. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    is_remote = REMOTE_MAP.get(prefs.remote_preference)

    # Normalize locations — capped at 5 to avoid slow scrapes.
    # Remote jobs are discovered via is_remote flag, not per-country search.
    locations = _normalize_locations(prefs.locations)
    if not locations:
        locations = ["usa"]

    console.print(f"  [dim]Searching {len(locations)} locations × {len(prefs.job_titles)} titles (LinkedIn + Indeed)[/dim]")

    with managed_session() as session:
        for title in prefs.job_titles:
            for location in locations:
                console.print(f"  [dim]JobSpy: \"{title}\" in {location}...[/dim]")
                try:
                    kwargs: dict = {
                        "site_name": ["indeed", "linkedin"],
                        "search_term": title,
                        "location": location,
                        "results_wanted": 25,
                        "hours_old": 48,
                        "job_type": "fulltime" if "full-time" in prefs.employment_type else None,
                    }
                    if is_remote is not None:
                        kwargs["is_remote"] = is_remote

                    df = scrape_jobs(**{k: v for k, v in kwargs.items() if v is not None})

                    if df is None or df.empty:
                        console.print("    [dim]No results[/dim]")
                        continue

                    import pandas as pd

                    def _safe_str(value, default: str = "") -> str:
                        """Coerce a pandas/None value to a string, normalizing NaN/None
                        to the supplied default. Plain str(NaN) returns the literal
                        string 'nan', and str(None) returns 'None' — both poison
                        downstream consumers (AI scorer, prefilter, hash)."""
                        if value is None or pd.isna(value):
                            return default
                        s = str(value).strip()
                        if s.lower() in ("none", "nan", "null", "n/a", ""):
                            return default
                        return s

                    for _, row in df.iterrows():
                        company = _safe_str(row.get("company"), "Unknown")
                        job_title = _safe_str(row.get("title"), "Unknown")
                        job_location = _safe_str(row.get("location"), location)
                        description = _safe_str(row.get("description"))
                        job_url = _safe_str(row.get("job_url"))

                        pf = prefilter_job(job_title, company, job_location, description, prefs)
                        if not pf.passed:
                            filtered += 1
                            continue

                        date_posted_raw = row.get("date_posted")
                        posted_at = None
                        if date_posted_raw is not None:
                            posted_at = parse_date(str(date_posted_raw))

                        jid = job_hash(company, job_title, job_location, job_url)
                        job = Job(
                            id=jid,
                            title=job_title,
                            company=company,
                            location=job_location,
                            source=str(row.get("site", "jobspy")),
                            url=job_url,
                            jd_text=description,
                            posted_at=posted_at,
                            status="scraped",
                            scraped_at=datetime.now(UTC),
                        )

                        if insert_if_new(session, job):
                            new_count += 1
                        else:
                            skipped += 1

                except Exception as e:
                    console.print(f"    [red]JobSpy error for \"{title}\" in {location}: {e}[/red]")

    return new_count, skipped, filtered
