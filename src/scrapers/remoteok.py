"""RemoteOK scraper — free JSON feed, no key needed."""

from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
API_URL = "https://remoteok.com/api"


def scrape_remoteok() -> tuple[int, int, int]:
    """Fetch jobs from RemoteOK JSON feed. Returns (new_count, skipped_count, filtered_count)."""
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            console.print("  [dim]Fetching RemoteOK feed...[/dim]")
            resp = httpx.get(
                API_URL,
                timeout=30,
                headers={"User-Agent": "Scout/1.0 (job search tool)"},
            )
            resp.raise_for_status()
            try:
                data = resp.json()
            except Exception:
                console.print("  [red]RemoteOK returned invalid JSON[/red]")
                return new_count, skipped, filtered

            if not isinstance(data, list):
                console.print("  [red]RemoteOK returned unexpected data format[/red]")
                return new_count, skipped, filtered

            # First element is often a legal notice (dict with "legal" key); skip it if so
            jobs_data = data
            if jobs_data and isinstance(jobs_data[0], dict) and "legal" in jobs_data[0]:
                jobs_data = jobs_data[1:]

            for item in jobs_data:
                company = item.get("company", "Unknown")
                title = item.get("position", "Unknown")
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
                    source="remoteok",
                    url=url,
                    jd_text=description,
                    posted_at=parse_date(item.get("date")),
                    status="scraped",
                    scraped_at=datetime.now(UTC),
                )

                if insert_if_new(session, job):
                    new_count += 1
                else:
                    skipped += 1

        except httpx.HTTPError as e:
            console.print(f"  [red]RemoteOK API error: {e}[/red]")

    return new_count, skipped, filtered
