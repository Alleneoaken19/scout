"""Hacker News "Who is Hiring?" scraper — Algolia API.

Scrapes the monthly community hiring threads on Hacker News.
These are goldmine posts: 300-500 curated startup/tech jobs per month,
often with salary, location, and tech stack in the post text.
"""

import re
from datetime import UTC, datetime

import httpx
from rich.console import Console

from src.database import Job, managed_session
from src.preferences import load_preferences
from src.scrapers.base import insert_if_new, job_hash, parse_date
from src.scrapers.prefilter import prefilter_job

console = Console()

ALGOLIA_SEARCH = "https://hn.algolia.com/api/v1/search_by_date"
ALGOLIA_ITEMS = "https://hn.algolia.com/api/v1/search"


def _find_latest_thread() -> str | None:
    """Find the most recent 'Who is hiring?' thread ID."""
    resp = httpx.get(
        ALGOLIA_SEARCH,
        params={
            "query": '"Who is hiring"',
            "tags": "story,author_whoishiring",
            "hitsPerPage": 3,
        },
        timeout=30,
    )
    resp.raise_for_status()
    try:
        search_data = resp.json()
    except Exception:
        return None
    hits = search_data.get("hits", [])
    for hit in hits:
        if "who is hiring" in hit.get("title", "").lower():
            return hit["objectID"]
    return None


def _parse_comment(text: str) -> dict:
    """Extract company, title, location from an HN hiring comment.

    HN hiring posts typically start with:
      Company Name | Role Title | Location | Remote | Salary
    """
    if not text:
        return {}

    # Strip HTML tags for parsing
    clean = re.sub(r"<[^>]+>", " ", text).strip()
    first_line = clean.split("\n")[0].strip()

    # Split on pipe delimiter (standard HN format)
    parts = [p.strip() for p in first_line.split("|")]

    if len(parts) >= 2:
        return {
            "company": parts[0],
            "title": parts[1],
            "location": parts[2] if len(parts) >= 3 else "Remote",
            "description": clean,
        }

    return {"company": "Unknown", "title": first_line[:80], "location": "Remote", "description": clean}


def scrape_hn_hiring() -> tuple[int, int, int]:
    """Fetch jobs from the latest HN 'Who is hiring?' thread.

    Returns (new_count, skipped_count, filtered_count).
    """
    prefs = load_preferences()
    new_count = 0
    skipped = 0
    filtered = 0

    with managed_session() as session:
        try:
            console.print("  [dim]Finding latest HN hiring thread...[/dim]")
            thread_id = _find_latest_thread()
            if not thread_id:
                console.print("  [yellow]No HN hiring thread found[/yellow]")
                return 0, 0, 0

            console.print(f"  [dim]Fetching comments from thread {thread_id}...[/dim]")
            resp = httpx.get(
                ALGOLIA_ITEMS,
                params={
                    "tags": f"comment,story_{thread_id}",
                    "hitsPerPage": 1000,
                },
                timeout=60,
            )
            resp.raise_for_status()
            try:
                data = resp.json()
            except Exception:
                console.print("  [red]HN Algolia returned invalid JSON[/red]")
                return new_count, skipped, filtered
            if not isinstance(data, dict):
                return 0, 0, 0
            comments = data.get("hits", [])
            console.print(f"  [dim]Found {len(comments)} job posts[/dim]")

            for comment in comments:
                if not isinstance(comment, dict):
                    continue
                # Only top-level comments (direct replies to thread) are job posts
                if str(comment.get("parent_id", "")) != str(thread_id):
                    continue

                text = comment.get("comment_text", "")
                parsed = _parse_comment(text)
                if not parsed or not parsed.get("title"):
                    continue

                company = parsed["company"]
                title = parsed["title"]
                location = parsed["location"]
                description = parsed["description"]

                result = prefilter_job(title, company, location, description, prefs)
                if not result.passed:
                    filtered += 1
                    continue

                object_id = comment.get("objectID", "")
                url = f"https://news.ycombinator.com/item?id={object_id}"
                jid = job_hash(company, title, location, url)
                job = Job(
                    id=jid,
                    title=title,
                    company=company,
                    location=location,
                    source="hackernews",
                    url=url,
                    jd_text=description,
                    posted_at=parse_date(comment.get("created_at")),
                    status="scraped",
                    scraped_at=datetime.now(UTC),
                )

                if insert_if_new(session, job):
                    new_count += 1
                else:
                    skipped += 1

        except Exception as e:
            console.print(f"  [red]HN hiring error: {e}[/red]")

    return new_count, skipped, filtered
