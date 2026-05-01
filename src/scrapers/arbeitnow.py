"""Arbeitnow scraper — free REST API, no key needed."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://www.arbeitnow.com/api/job-board-api"


def scrape_arbeitnow() -> tuple[int, int, int]:
    """Fetch jobs from Arbeitnow API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            page = 1
            while True:
                console.print(f"  [dim]Fetching Arbeitnow page {page}...[/dim]")
                try:
                    resp = httpx.get(API_URL, params={"page": page}, timeout=30)
                    resp.raise_for_status()
                except httpx.HTTPError as e:
                    console.print(f"  [dim]Stopped at page {page}: {e}[/dim]")
                    break

                try:
                    data = resp.json()
                except Exception:
                    console.print("  [red]Arbeitnow returned invalid JSON[/red]")
                    break
                if not isinstance(data, dict):
                    console.print("  [red]Arbeitnow returned unexpected data format[/red]")
                    break
                jobs_data = data.get("data", [])
                if not jobs_data:
                    break

                for item in jobs_data:
                    company = item.get("company_name", "Unknown")
                    title = item.get("title", "Unknown")
                    location = item.get("location", "Remote")
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
                        source="arbeitnow",
                        url=url,
                        jd_text=item.get("description", ""),
                        posted_at=parse_date(item.get("created_at")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                    else:
                        skipped += 1

                if not data.get("links", {}).get("next"):
                    break
                page += 1

        except Exception as e:
            console.print(f"  [red]Arbeitnow error: {e}[/red]")

    return new_count, skipped, filtered
