"""Notion sync -- push job pipeline data + application tracking to Notion."""

import time

from notion_client import Client
from rich.console import Console

from src.database import Application, Job, managed_session
from src.settings import load_settings
console = Console()

RATE_LIMIT_DELAY = 0.4  # 400ms between requests (Notion free tier: 3 req/s)
MAX_RETRIES = 2


def get_notion_client() -> Client:
    """Create Notion client from settings."""
    settings = load_settings()
    token = settings.notion_token
    if not token or token == "secret_xxxx":
        raise RuntimeError(
            "NOTION_TOKEN not set. Configure it in Settings or create a free integration at notion.so/my-integrations "
            "and add the token to .env"
        )
    return Client(auth=token)


def get_database_id() -> str:
    """Get Notion Jobs Pipeline database ID from settings."""
    settings = load_settings()
    db_id = settings.notion_db_id
    if not db_id or db_id == "xxxx":
        raise RuntimeError(
            "NOTION_JOBS_DB_ID not set. Configure it in Settings or add the database ID to .env"
        )
    return db_id


def _ensure_database_schema(notion: Client, db_id: str) -> None:
    """Create required properties on the Notion database."""
    try:
        notion.databases.update(
            database_id=db_id,
            properties={
                "Company": {"rich_text": {}},
                "Role": {"rich_text": {}},
                "Location": {"rich_text": {}},
                "Source": {"select": {"options": [
                    {"name": "arbeitnow", "color": "blue"},
                    {"name": "remoteok", "color": "green"},
                    {"name": "indeed", "color": "orange"},
                    {"name": "linkedin", "color": "purple"},
                    {"name": "remotive", "color": "pink"},
                    {"name": "weworkremotely", "color": "yellow"},
                    {"name": "himalayas", "color": "brown"},
                    {"name": "jobicy", "color": "red"},
                    {"name": "androidjobs", "color": "blue"},
                    {"name": "echojobs", "color": "green"},
                    {"name": "hackernews", "color": "orange"},
                    {"name": "greenhouse", "color": "purple"},
                    {"name": "landingjobs", "color": "pink"},
                    {"name": "themuse", "color": "yellow"},
                    {"name": "workingnomads", "color": "gray"},
                ]}},
                "Status": {"select": {"options": [
                    {"name": "scraped", "color": "default"},
                    {"name": "scored", "color": "blue"},
                    {"name": "apply_queue", "color": "green"},
                    {"name": "manual_review", "color": "yellow"},
                    {"name": "applied", "color": "purple"},
                    {"name": "under_review", "color": "orange"},
                    {"name": "interview", "color": "pink"},
                    {"name": "offer", "color": "green"},
                    {"name": "rejected", "color": "red"},
                    {"name": "ghosted", "color": "gray"},
                ]}},
                "Match Score": {"number": {"format": "percent"}},
                "URL": {"url": {}},
                "Action": {"select": {"options": [
                    {"name": "apply", "color": "green"},
                    {"name": "skip", "color": "red"},
                    {"name": "manual_review", "color": "yellow"},
                ]}},
                "Applied Via": {"rich_text": {}},
                "Applied Date": {"date": {}},
                "Scraped Date": {"date": {}},
                "Response Days": {"number": {}},
                "Interview Date": {"date": {}},
                "Email Count": {"number": {}},
                "Notes": {"rich_text": {}},
            },
        )
        console.print("  [green]Database schema updated[/green]")
    except Exception as e:
        console.print(f"  [dim]Schema update note: {e}[/dim]")


def _notion_request_with_retry(func, *args, **kwargs):
    """Execute a Notion API call with retry on rate limit (429)."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            error_str = str(e)
            # Check for rate limit error
            if "429" in error_str or "rate" in error_str.lower():
                if attempt < MAX_RETRIES:
                    wait = RATE_LIMIT_DELAY * (2 ** (attempt + 1))  # Exponential backoff
                    time.sleep(wait)
                    continue
            raise


def _strip_bad_properties(properties: dict, error_msg: str) -> dict:
    """Remove properties mentioned as missing in a Notion API error message."""
    import re
    # Error format: "XYZ is not a property that exists."
    bad_names = set(re.findall(r"(\w[\w\s]*?) is not a property that exists", error_msg))
    if not bad_names:
        return properties
    return {k: v for k, v in properties.items() if k not in bad_names}


def sync_to_notion() -> tuple[int, int]:
    """Sync all scored/applied jobs to Notion. Returns (created, updated)."""
    notion = get_notion_client()
    db_id = get_database_id()

    _ensure_database_schema(notion, db_id)
    time.sleep(RATE_LIMIT_DELAY)

    with managed_session() as session:
        jobs = session.query(Job).filter(
            Job.status.in_(["scored", "apply_queue", "manual_review", "applied",
                            "under_review", "interview", "offer", "rejected", "ghosted"])
        ).all()

        if not jobs:
            console.print("  [dim]No jobs to sync.[/dim]")
            return 0, 0

        # Pre-load application data for applied jobs
        app_map = {}
        apps = session.query(Application).filter(Application.is_dry_run.is_(False)).all()
        for a in apps:
            app_map[a.job_id] = a

        existing_pages = _get_existing_pages(session)

        created = 0
        updated = 0
        errors = 0

        for job in jobs:
            time.sleep(RATE_LIMIT_DELAY)

            app = app_map.get(job.id)
            properties = _job_to_properties(job, app)

            if job.id in existing_pages:
                try:
                    _notion_request_with_retry(
                        notion.pages.update,
                        page_id=existing_pages[job.id],
                        properties=properties,
                    )
                    updated += 1
                except Exception as e:
                    # Retry with only core properties if a property doesn't exist
                    if "is not a property that exists" in str(e):
                        try:
                            safe_props = _strip_bad_properties(properties, str(e))
                            _notion_request_with_retry(
                                notion.pages.update,
                                page_id=existing_pages[job.id],
                                properties=safe_props,
                            )
                            updated += 1
                        except Exception as e2:
                            console.print(f"  [red]Update failed for {job.company}: {e2}[/red]")
                            errors += 1
                    else:
                        console.print(f"  [red]Update failed for {job.company}: {e}[/red]")
                        errors += 1
            else:
                try:
                    page = _notion_request_with_retry(
                        notion.pages.create,
                        parent={"database_id": db_id},
                        properties=properties,
                    )
                    job.notion_page_id = page["id"]
                    created += 1
                except Exception as e:
                    # Retry with only core properties if a property doesn't exist
                    if "is not a property that exists" in str(e):
                        try:
                            safe_props = _strip_bad_properties(properties, str(e))
                            page = _notion_request_with_retry(
                                notion.pages.create,
                                parent={"database_id": db_id},
                                properties=safe_props,
                            )
                            job.notion_page_id = page["id"]
                            created += 1
                        except Exception as e2:
                            console.print(f"  [red]Create failed for {job.company}: {e2}[/red]")
                            errors += 1
                    else:
                        console.print(f"  [red]Create failed for {job.company}: {e}[/red]")
                        errors += 1

        if errors:
            console.print(f"  [yellow]{errors} jobs failed to sync[/yellow]")

    return created, updated


def _job_to_properties(job: Job, app: Application | None = None) -> dict:
    """Convert a Job + its Application to Notion page properties."""
    props: dict = {
        "Company": {"title": [{"text": {"content": f"{job.company} -- {job.title}"[:100]}}]},
        "Role": {"rich_text": [{"text": {"content": job.title or ""}}]},
        "Location": {"rich_text": [{"text": {"content": job.location or ""}}]},
        "Source": {"select": {"name": job.source or "unknown"}},
        "Status": {"select": {"name": job.status or "scraped"}},
    }

    if job.match_score is not None:
        props["Match Score"] = {"number": round(job.match_score, 2)}

    if job.url:
        props["URL"] = {"url": job.url}

    if job.recommended_action:
        props["Action"] = {"select": {"name": job.recommended_action}}

    if job.scraped_at:
        props["Scraped Date"] = {"date": {"start": job.scraped_at.strftime("%Y-%m-%d")}}

    # Application-level data
    if app:
        if app.applied_via:
            props["Applied Via"] = {"rich_text": [{"text": {"content": app.applied_via}}]}

        if app.created_at:
            props["Applied Date"] = {"date": {"start": app.created_at.strftime("%Y-%m-%d")}}

        if app.interview_at:
            props["Interview Date"] = {"date": {"start": app.interview_at.strftime("%Y-%m-%d")}}

        if app.email_count:
            props["Email Count"] = {"number": app.email_count}

        # Calculate response days
        if app.first_response_at and app.created_at:
            delta = (app.first_response_at - app.created_at).days
            props["Response Days"] = {"number": delta}

        if app.notes:
            props["Notes"] = {"rich_text": [{"text": {"content": (app.notes or "")[:200]}}]}
    elif job.applied_at:
        props["Applied Date"] = {"date": {"start": job.applied_at.strftime("%Y-%m-%d")}}

    return props


def _get_existing_pages(session=None) -> dict[str, str]:
    """Get map of job_id -> notion_page_id for existing pages."""
    if session:
        jobs_with_pages = session.query(Job).filter(Job.notion_page_id.isnot(None)).all()
        return {j.id: j.notion_page_id for j in jobs_with_pages}

    with managed_session() as session:
        jobs_with_pages = session.query(Job).filter(Job.notion_page_id.isnot(None)).all()
        return {j.id: j.notion_page_id for j in jobs_with_pages}
