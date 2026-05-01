"""Himalayas scraper — remote jobs REST API, no key needed.

Comprehensive API with salary data, pagination, and structured fields.
"""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://himalayas.app/jobs/api"
PAGE_SIZE = 50
MAX_PAGES = 5  # Cap at 250 jobs to stay respectful


def scrape_himalayas() -> tuple[int, int, int]:
    """Fetch jobs from Himalayas API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            offset = 0
            for page in range(1, MAX_PAGES + 1):
                console.print(f"  [dim]Fetching Himalayas page {page}...[/dim]")
                try:
                    resp = httpx.get(
                        API_URL,
                        params={"limit": PAGE_SIZE, "offset": offset},
                        timeout=30,
                    )
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped at page {page}: {e}[/dim]")
                    break

                try:
                    data = resp.json()
                except Exception:
                    console.print("  [red]Himalayas returned invalid JSON[/red]")
                    break
                if not isinstance(data, dict):
                    console.print("  [red]Himalayas returned unexpected data format[/red]")
                    break
                jobs_data = data.get("jobs", [])
                if not jobs_data:
                    break

                for item in jobs_data:
                    company = item.get("companyName", "Unknown")
                    title = item.get("title", "Unknown")
                    locations = item.get("locationRestrictions", [])
                    location = locations[0] if isinstance(locations, list) and locations else "Remote"
                    description = item.get("description", "")
                    url = item.get("applicationLink", "")

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
                        source="himalayas",
                        url=url,
                        jd_text=description,
                        posted_at=parse_date(item.get("pubDate") or item.get("publishedDate")),
                        deadline=parse_date(item.get("expiryDate")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                    else:
                        skipped += 1

                offset += PAGE_SIZE

                total = data.get("totalCount", 0)
                if offset >= total:
                    break

        except Exception as e:
            console.print(f"  [red]Himalayas error: {e}[/red]")

    return new_count, skipped, filtered
