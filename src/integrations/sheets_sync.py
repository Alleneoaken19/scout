"""Google Sheets export -- comprehensive application data + analytics."""

import json
from datetime import UTC, datetime, timedelta

import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from rich.console import Console

from src.database import Application, Job, managed_session
from src.paths import CREDENTIALS_DIR

console = Console()

SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
TOKEN_PATH = CREDENTIALS_DIR / "sheets_token.json"
CLIENT_SECRET_PATH = CREDENTIALS_DIR / "client_secret.json"


def authenticate_sheets() -> Credentials:
    """Run OAuth flow or refresh token for Google Sheets."""
    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
    creds = None

    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CLIENT_SECRET_PATH.exists():
                console.print("[red]client_secret.json not found![/red]")
                console.print(
                    "  1. Go to console.cloud.google.com -> APIs & Services -> Credentials\n"
                    "  2. Create OAuth 2.0 Client ID (Desktop app)\n"
                    "  3. Download JSON and save to:\n"
                    f"     {CLIENT_SECRET_PATH}"
                )
                raise FileNotFoundError(str(CLIENT_SECRET_PATH))

            flow = InstalledAppFlow.from_client_secrets_file(
                str(CLIENT_SECRET_PATH), SCOPES
            )
            creds = flow.run_local_server(port=0)

        TOKEN_PATH.write_text(creds.to_json())
        TOKEN_PATH.chmod(0o600)  # Owner read/write only
        console.print(f"  [green]Token saved to {TOKEN_PATH}[/green]")

    return creds


def _safe_json_list(raw: str | None) -> list:
    """Parse a JSON string as list, returning [] on any error."""
    if not raw:
        return []
    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def sync_to_sheets() -> int:
    """Export all application data to Google Sheets. Returns rows written."""
    creds = authenticate_sheets()
    gc = gspread.authorize(creds)

    try:
        spreadsheet = gc.open("Scout Applications")
    except gspread.SpreadsheetNotFound:
        spreadsheet = gc.create("Scout Applications")
        spreadsheet.share(None, perm_type="anyone", role="writer")
        console.print("  [green]Created 'Scout Applications' spreadsheet[/green]")

    with managed_session() as session:
        _write_job_pipeline(spreadsheet, session)
        _write_application_details(spreadsheet, session)
        _write_weekly_stats(spreadsheet, session)
        _write_source_performance(spreadsheet, session)

        rows = session.query(Job).filter(Job.status != "scraped").count()

    return rows


def _write_job_pipeline(spreadsheet, session) -> None:
    """Sheet 1: Full job pipeline -- all non-scraped jobs."""
    try:
        sheet = spreadsheet.worksheet("Job Pipeline")
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet("Job Pipeline", rows=2000, cols=12)

    headers = [
        "Company", "Title", "Location", "Source", "Status",
        "Match Score", "Action", "Scraped", "Applied", "URL",
        "ATS Keywords", "Red Flags",
    ]

    jobs = session.query(Job).filter(
        Job.status.in_(["scored", "apply_queue", "manual_review", "applied",
                        "under_review", "interview", "offer", "rejected", "ghosted"])
    ).order_by(Job.match_score.desc()).all()

    rows = [headers]
    for j in jobs:
        keywords = ", ".join(_safe_json_list(j.ats_keywords))
        flags = ", ".join(_safe_json_list(j.red_flags))

        rows.append([
            j.company or "",
            j.title or "",
            j.location or "",
            j.source or "",
            j.status or "",
            f"{j.match_score:.0%}" if j.match_score else "",
            j.recommended_action or "",
            j.scraped_at.strftime("%Y-%m-%d") if j.scraped_at else "",
            j.applied_at.strftime("%Y-%m-%d") if j.applied_at else "",
            j.url or "",
            keywords,
            flags,
        ])

    sheet.clear()
    if rows:
        sheet.update(range_name="A1", values=rows)
    console.print(f"    [dim]Job Pipeline: {len(rows) - 1} rows[/dim]")


def _write_application_details(spreadsheet, session) -> None:
    """Sheet 2: Detailed application tracking -- one row per application."""
    try:
        sheet = spreadsheet.worksheet("Applications")
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet("Applications", rows=500, cols=16)

    headers = [
        "Company", "Title", "Portal", "Status",
        "Applied On", "First Response", "Last Email", "Interview",
        "Offer Date", "Rejected Date", "Email Count",
        "Response Days", "Match Score", "Notes", "URL",
    ]

    apps = session.query(Application).filter(
        Application.is_dry_run.is_(False)
    ).order_by(Application.created_at.desc()).all()

    rows = [headers]
    for a in apps:
        job = session.get(Job, a.job_id)

        # Calculate response time
        response_days = ""
        if a.first_response_at and a.created_at:
            delta = (a.first_response_at - a.created_at).days
            response_days = str(delta)

        rows.append([
            job.company if job else "",
            job.title if job else "",
            a.applied_via or "",
            a.status or "",
            a.created_at.strftime("%Y-%m-%d") if a.created_at else "",
            a.first_response_at.strftime("%Y-%m-%d") if a.first_response_at else "",
            a.last_email_at.strftime("%Y-%m-%d") if a.last_email_at else "",
            a.interview_at.strftime("%Y-%m-%d") if a.interview_at else "",
            a.offer_at.strftime("%Y-%m-%d") if a.offer_at else "",
            a.rejected_at.strftime("%Y-%m-%d") if a.rejected_at else "",
            str(a.email_count or 0),
            response_days,
            f"{job.match_score:.0%}" if job and job.match_score else "",
            a.notes or "",
            job.url if job else "",
        ])

    sheet.clear()
    if rows:
        sheet.update(range_name="A1", values=rows)
    console.print(f"    [dim]Applications: {len(rows) - 1} rows[/dim]")


def _write_weekly_stats(spreadsheet, session) -> None:
    """Sheet 3: Weekly metrics with conversion rates."""
    try:
        sheet = spreadsheet.worksheet("Weekly Stats")
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet("Weekly Stats", rows=100, cols=10)

    headers = [
        "Week", "Scraped", "Scored", "Applied", "Interviews",
        "Offers", "Rejected", "Ghosted", "Apply Rate", "Interview Rate",
    ]

    rows = [headers]
    now = datetime.now(UTC)

    for week_offset in range(12):
        week_end = now - timedelta(weeks=week_offset)
        week_start = week_end - timedelta(weeks=1)
        week_label = week_start.strftime("%b %d") + " - " + week_end.strftime("%b %d")

        scraped = session.query(Job).filter(
            Job.scraped_at >= week_start, Job.scraped_at < week_end
        ).count()

        scored = session.query(Job).filter(
            Job.match_score.isnot(None),
            Job.scraped_at >= week_start, Job.scraped_at < week_end
        ).count()

        applied = session.query(Job).filter(
            Job.status == "applied",
            Job.applied_at.isnot(None),
            Job.applied_at >= week_start, Job.applied_at < week_end
        ).count()

        interviews = session.query(Job).filter(
            Job.status == "interview",
            Job.applied_at.isnot(None),
            Job.applied_at >= week_start, Job.applied_at < week_end
        ).count()

        offers = session.query(Job).filter(
            Job.status == "offer",
            Job.applied_at.isnot(None),
            Job.applied_at >= week_start, Job.applied_at < week_end
        ).count()

        rejected = session.query(Job).filter(
            Job.status == "rejected",
            Job.applied_at.isnot(None),
            Job.applied_at >= week_start, Job.applied_at < week_end
        ).count()

        ghosted = session.query(Job).filter(
            Job.status == "ghosted",
            Job.applied_at.isnot(None),
            Job.applied_at >= week_start, Job.applied_at < week_end
        ).count()

        apply_rate = f"{applied / scraped:.0%}" if scraped > 0 else ""
        interview_rate = f"{interviews / applied:.0%}" if applied > 0 else ""

        rows.append([week_label, scraped, scored, applied, interviews,
                     offers, rejected, ghosted, apply_rate, interview_rate])

    sheet.clear()
    sheet.update(range_name="A1", values=rows)
    console.print(f"    [dim]Weekly Stats: {len(rows) - 1} weeks[/dim]")


def _write_source_performance(spreadsheet, session) -> None:
    """Sheet 4: Performance breakdown by job source."""
    try:
        sheet = spreadsheet.worksheet("Source Performance")
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet("Source Performance", rows=50, cols=8)

    headers = [
        "Source", "Total Jobs", "Scored", "Applied",
        "Interviews", "Offers", "Apply Rate", "Interview Rate",
    ]

    sources = session.query(Job.source).distinct().all()

    rows = [headers]
    for (src,) in sources:
        total = session.query(Job).filter(Job.source == src).count()
        scored = session.query(Job).filter(Job.source == src, Job.match_score.isnot(None)).count()
        applied = session.query(Job).filter(Job.source == src, Job.status == "applied").count()
        interviews = session.query(Job).filter(Job.source == src, Job.status == "interview").count()
        offers = session.query(Job).filter(Job.source == src, Job.status == "offer").count()

        apply_rate = f"{applied / total:.0%}" if total > 0 else ""
        interview_rate = f"{interviews / applied:.0%}" if applied > 0 else ""

        rows.append([src, total, scored, applied, interviews, offers, apply_rate, interview_rate])

    sheet.clear()
    sheet.update(range_name="A1", values=rows)
    console.print(f"    [dim]Source Performance: {len(rows) - 1} sources[/dim]")
