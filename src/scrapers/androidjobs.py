"""AndroidJobs.io scraper — Android-specific job board, public JSON API."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://androidjobs.io/jobs.json"
MAX_PAGES = 3


def scrape_androidjobs() -> tuple[int, int, int]:
    """Fetch jobs from AndroidJobs.io API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            for page in range(1, MAX_PAGES + 1):
                console.print(f"  [dim]Fetching AndroidJobs.io page {page}...[/dim]")
                try:
                    resp = httpx.get(API_URL, params={"page": page}, timeout=30)
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped at page {page}: {e}[/dim]")
                    break

                try:
                    jobs_data = resp.json()
                except Exception:
                    console.print("  [red]AndroidJobs returned invalid JSON[/red]")
                    break
                if not isinstance(jobs_data, list) or not jobs_data:
                    break

                for item in jobs_data:
                    if not isinstance(item, dict):
                        continue
                    company_info = item.get("company", {})
                    company = company_info.get("name", "Unknown") if isinstance(company_info, dict) else str(company_info or "Unknown")
                    title = item.get("title", "Unknown")

                    # location can be a dict like {"onsite": ..., "remote": ...} or a string
                    raw_location = item.get("location", "Remote")
                    if isinstance(raw_location, dict):
                        location = "Remote" if raw_location.get("remote") else raw_location.get("onsite", "Remote")
                        if not isinstance(location, str):
                            location = "Remote"
                    else:
                        location = str(raw_location) if raw_location else "Remote"

                    raw_desc = item.get("description", "")
                    if isinstance(raw_desc, dict):
                        description = raw_desc.get("plain", "") or raw_desc.get("html", "") or ""
                    else:
                        description = str(raw_desc) if raw_desc else ""

                    url = item.get("application_link", "")

                    limits = item.get("location_limits", "")
                    if isinstance(limits, list) and limits:
                        # Take first location limit string
                        first_limit = limits[0]
                        if isinstance(first_limit, str) and first_limit:
                            location = first_limit
                    elif isinstance(limits, str) and limits:
                        location = limits

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
                        source="androidjobs",
                        url=url,
                        jd_text=description,
                        posted_at=parse_date(item.get("published_at") or item.get("created_at")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                    else:
                        skipped += 1

        except Exception as e:
            console.print(f"  [red]AndroidJobs error: {e}[/red]")

    return new_count, skipped, filtered
