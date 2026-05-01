"""EchoJobs scraper — 1M+ jobs aggregator, public JSON API, no key needed."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://echojobs.io/api/jobs"
MAX_PAGES = 3  # 3 pages × 25 jobs = 75 jobs per scrape


def scrape_echojobs() -> tuple[int, int, int]:
    """Fetch engineering jobs from EchoJobs API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            for page in range(1, MAX_PAGES + 1):
                console.print(f"  [dim]Fetching EchoJobs page {page}...[/dim]")
                try:
                    resp = httpx.get(
                        API_URL,
                        params={"page": page, "per_page": 25},
                        timeout=30,
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped at page {page}: {e}[/dim]")
                    break

                try:
                    data = resp.json()
                except Exception:
                    console.print("  [red]EchoJobs returned invalid JSON[/red]")
                    break
                jobs_data = data if isinstance(data, list) else data.get("jobs", data.get("data", []))
                if not isinstance(jobs_data, list):
                    console.print("  [red]EchoJobs returned unexpected data format[/red]")
                    break
                if not jobs_data:
                    break

                for item in jobs_data:
                    company = item.get("company_name", "Unknown")
                    title = item.get("title", "Unknown")
                    locations = item.get("locations", [])
                    location = ", ".join(locations) if isinstance(locations, list) and locations else "Remote"
                    description = item.get("description", "")
                    url = item.get("url", "")

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
                        source="echojobs",
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
            console.print(f"  [red]EchoJobs error: {e}[/red]")

    return new_count, skipped, filtered
