"""Greenhouse Boards API scraper — direct access to top tech company job boards.

Greenhouse is used by thousands of companies. This scraper checks a curated
list of top tech companies' public boards for matching roles.
No API key needed — these are public job board endpoints.
"""

import time
from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()
BOARDS_API = "https://boards-api.greenhouse.io/v1/boards"

# Curated list of top tech companies using Greenhouse.
# Add more slugs as you discover them.
TOP_COMPANIES = [
    "anthropic",
    "discord",
    "figma",
    "stripe",
    "notion",
    "cloudflare",
    "databricks",
    "reddit",
    "duolingo",
    "plaid",
    "coinbase",
    "affirm",
    "brex",
    "airtable",
    "linear",
    "vercel",
    "duckduckgo",
    "gitlab",
    "retool",
    "anduril",
    "deel",
    "ramp",
    "scale",
    "instacart",
    "gusto",
    "vanta",
    "rippling",
    "wiz",
    "datadog",
    "snyk",
]

RATE_DELAY = 0.3  # Be respectful to Greenhouse API


def scrape_greenhouse_boards() -> tuple[int, int, int]:
    """Fetch jobs from top tech company Greenhouse boards.

    Returns (new_count, skipped_count, filtered_count).
    """
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        console.print(f"  [dim]Checking {len(TOP_COMPANIES)} company boards...[/dim]")

        for slug in TOP_COMPANIES:
            try:
                time.sleep(RATE_DELAY)
                resp = httpx.get(
                    f"{BOARDS_API}/{slug}/jobs",
                    params={"content": "true"},
                    timeout=15,
                )
                if resp.status_code == 404:
                    continue  # Company not on Greenhouse or slug changed
                resp.raise_for_status()

                try:
                    data = resp.json()
                except Exception:
                    console.print(f"  [red]{slug}: returned invalid JSON[/red]")
                    continue
                if not isinstance(data, dict):
                    continue
                jobs_data = data.get("jobs", [])
                if not jobs_data:
                    continue

                company_name = jobs_data[0].get("company_name", slug) if jobs_data else slug
                board_hits = 0

                for item in jobs_data:
                    if not isinstance(item, dict):
                        continue
                    title = item.get("title", "Unknown")
                    location_obj = item.get("location", {})
                    location = location_obj.get("name", "Remote") if isinstance(location_obj, dict) else "Remote"
                    description = item.get("content", "")
                    url = item.get("absolute_url", "")

                    result = prefilter_job(title, company_name, location, description, prefs)
                    if not result.passed:
                        filtered += 1
                        continue

                    jid = job_hash(company_name, title, location, url)
                    job = Job(
                        id=jid,
                        title=title,
                        company=company_name,
                        location=location,
                        source="greenhouse",
                        url=url,
                        jd_text=description,
                        posted_at=parse_date(item.get("updated_at")),
                        status="scraped",
                        scraped_at=datetime.now(UTC),
                    )

                    if insert_if_new(session, job):
                        new_count += 1
                        board_hits += 1
                    else:
                        skipped += 1

                if board_hits > 0:
                    console.print(f"  [dim]  {company_name}: +{board_hits} matching roles[/dim]")

            except Exception as e:
                console.print(f"  [dim]  {slug}: error — {e}[/dim]")

    return new_count, skipped, filtered
