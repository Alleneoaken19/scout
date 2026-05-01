"""Working Nomads scraper — curated remote jobs, public JSON API."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://www.workingnomads.com/api/exposed_jobs/"


def scrape_workingnomads() -> tuple[int, int, int]:
    """Fetch jobs from Working Nomads API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            console.print("  [dim]Fetching Working Nomads feed...[/dim]")
            resp = httpx.get(API_URL, timeout=30)
            resp.raise_for_status()
            try:
                jobs_data = resp.json()
            except Exception:
                console.print("  [red]Working Nomads returned invalid JSON[/red]")
                return new_count, skipped, filtered

            if not isinstance(jobs_data, list):
                console.print("  [red]Working Nomads returned unexpected data format[/red]")
                return new_count, skipped, filtered

            for item in jobs_data:
                company = item.get("company_name", "Unknown")
                title = item.get("title", "Unknown")
                location = item.get("location", "Remote")
                if not location:
                    location = "Remote"
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
                    source="workingnomads",
                    url=url,
                    jd_text=description,
                    posted_at=parse_date(item.get("pub_date")),
                    status="scraped",
                    scraped_at=datetime.now(UTC),
                )

                if insert_if_new(session, job):
                    new_count += 1
                else:
                    skipped += 1

        except httpx.HTTPError as e:
            console.print(f"  [red]Working Nomads API error: {e}[/red]")

    return new_count, skipped, filtered
