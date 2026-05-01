"""Landing.jobs scraper — European tech jobs, public REST API with salary data."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://landing.jobs/api/v1/jobs"
PAGE_SIZE = 50
MAX_PAGES = 3


def scrape_landingjobs() -> tuple[int, int, int]:
    """Fetch jobs from Landing.jobs API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            for page in range(MAX_PAGES):
                offset = page * PAGE_SIZE
                console.print(f"  [dim]Fetching Landing.jobs (offset {offset})...[/dim]")
                try:
                    resp = httpx.get(
                        API_URL,
                        params={"limit": PAGE_SIZE, "offset": offset},
                        timeout=30,
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped: {e}[/dim]")
                    break

                try:
                    jobs_data = resp.json()
                except Exception:
                    console.print("  [red]Landing.jobs returned invalid JSON[/red]")
                    break
                if not isinstance(jobs_data, list) or not jobs_data:
                    break

                for item in jobs_data:
                    if not isinstance(item, dict):
                        continue
                    company_id = item.get("company_id", "")
                    title = item.get("title", "Unknown")
                    city = item.get("city", "")
                    country = item.get("country_name", "")
                    location = f"{city}, {country}".strip(", ") if city or country else "Remote"
                    if item.get("remote"):
                        location = f"Remote — {location}" if location != "Remote" else "Remote"
                    description = item.get("role_description", "")
                    url = item.get("url", "")
                    company = str(company_id)  # Landing.jobs uses company_id in job listing

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
                        source="landingjobs",
                        url=url,
                        jd_text=description,
                        posted_at=parse_date(item.get("published_at")),
                        deadline=parse_date(item.get("expires_at")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                    else:
                        skipped += 1

        except Exception as e:
            console.print(f"  [red]Landing.jobs error: {e}[/red]")

    return new_count, skipped, filtered
