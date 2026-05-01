"""Jobicy scraper — remote jobs REST API, no key needed.

Attribution: Powered by Jobicy (https://jobicy.com)
"""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://jobicy.com/api/v2/remote-jobs"


def scrape_jobicy() -> tuple[int, int, int]:
    """Fetch jobs from Jobicy API. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            console.print("  [dim]Fetching Jobicy feed...[/dim]")
            resp = httpx.get(API_URL, params={"count": 50}, timeout=30)
            resp.raise_for_status()
            try:
                data = resp.json()
            except Exception:
                console.print("  [red]Jobicy returned invalid JSON[/red]")
                return new_count, skipped, filtered

            if not isinstance(data, dict):
                console.print("  [red]Jobicy returned unexpected data format[/red]")
                return new_count, skipped, filtered
            jobs_data = data.get("jobs", [])

            for item in jobs_data:
                company = item.get("companyName", "Unknown")
                title = item.get("jobTitle", "Unknown")
                location = item.get("jobGeo", "Remote")
                if not location:
                    location = "Remote"
                description = item.get("jobDescription", "") or item.get("jobExcerpt", "")
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
                    source="jobicy",
                    url=url,
                    jd_text=description,
                    posted_at=parse_date(item.get("pubDate")),
                    status="scraped",
                    scraped_at=datetime.now(UTC),
                )

                if insert_if_new(session, job):
                    new_count += 1
                else:
                    skipped += 1

        except httpx.HTTPError as e:
            console.print(f"  [red]Jobicy API error: {e}[/red]")

    return new_count, skipped, filtered
