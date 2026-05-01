"""The Muse scraper — 495K+ jobs, fully public REST API, no auth needed."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://www.themuse.com/api/public/jobs"
MAX_PAGES = 3


def scrape_themuse() -> tuple[int, int, int]:
    """Fetch jobs from The Muse API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            for page in range(MAX_PAGES):
                console.print(f"  [dim]Fetching The Muse page {page + 1}...[/dim]")
                try:
                    resp = httpx.get(
                        API_URL,
                        params={"page": page, "descending": "true"},
                        timeout=30,
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped: {e}[/dim]")
                    break

                try:
                    data = resp.json()
                except Exception:
                    console.print("  [red]The Muse returned invalid JSON[/red]")
                    break
                if not isinstance(data, dict):
                    break
                jobs_data = data.get("results", [])
                if not jobs_data:
                    break

                for item in jobs_data:
                    if not isinstance(item, dict):
                        continue
                    company_info = item.get("company", {})
                    company = company_info.get("name", "Unknown") if isinstance(company_info, dict) else "Unknown"
                    title = item.get("name", "Unknown")
                    locations = item.get("locations", [])
                    location = locations[0].get("name", "Remote") if locations and isinstance(locations[0], dict) else "Remote"
                    description = item.get("contents", "")
                    refs = item.get("refs", {})
                    url = refs.get("landing_page", "") if isinstance(refs, dict) else ""

                    result = prefilter_job(title, company, location, description, prefs)
                    if not result.passed:
                        filtered += 1
                        continue

                    jid = job_hash(company, title, location, url)
                    job = Job(
                        id=jid,
                        title=title,
                        company=company,
                        location=location,
                        source="themuse",
                        url=url,
                        jd_text=description,
                        posted_at=parse_date(item.get("publication_date")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                    else:
                        skipped += 1

        except Exception as e:
            console.print(f"  [red]The Muse error: {e}[/red]")

    return new_count, skipped, filtered
