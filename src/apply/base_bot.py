"""Base apply bot -- shared logic for all ATS bots."""

import random
import time
import uuid
from datetime import UTC, datetime

from playwright.sync_api import Page, sync_playwright
from rich.console import Console

from src.database import Application, Job, managed_session
from src.preferences import load_preferences

console = Console()


def human_delay(min_sec: float = 1.0, max_sec: float = 3.0) -> None:
    """Random delay to mimic human behavior."""
    time.sleep(random.uniform(min_sec, max_sec))


# Track last application time per portal to enforce per-site rate limits
_last_apply_time: dict[str, float] = {}
MIN_SITE_DELAY = 30  # Minimum seconds between applications to the same ATS portal


def rate_limit_site(portal: str) -> None:
    """Enforce minimum delay between applications to the same ATS portal."""
    now = time.time()
    last = _last_apply_time.get(portal, 0)
    elapsed = now - last
    if elapsed < MIN_SITE_DELAY:
        wait = MIN_SITE_DELAY - elapsed
        console.print(f"  [dim]Rate limiting: waiting {wait:.0f}s before next {portal} application[/dim]")
        time.sleep(wait)
    _last_apply_time[portal] = time.time()


def check_regulated_domain() -> bool:
    """Check if user's domain is regulated (medical, education).

    Returns True if auto-apply should be blocked.
    Regulated professions require manual review of every application
    due to licensing, certification, and legal requirements.
    """
    from src.domain import detect_domain, is_regulated
    prefs = load_preferences()
    domain = detect_domain(prefs.job_titles)
    if is_regulated(domain):
        console.print(
            f"[red]Auto-apply is disabled for {domain} roles.[/red]\n"
            f"  Healthcare and education applications require manual review\n"
            f"  to verify credential and licensing requirements.\n"
            f"  Use [cyan]scout apply --dry-run[/cyan] to preview, then apply manually."
        )
        return True
    return False


def check_duplicate(job_id: str) -> bool:
    """Check if we already submitted a real application for this job. Returns True if duplicate."""
    with managed_session() as session:
        existing = session.query(Application).filter(
            Application.job_id == job_id,
            Application.is_dry_run.is_(False),
            Application.status != "error",
        ).first()
        return existing is not None


def check_daily_cap() -> bool:
    """Check if we've hit the daily application cap. Returns True if at cap."""
    prefs = load_preferences()

    with managed_session() as session:
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = session.query(Application).filter(
            Application.is_dry_run.is_(False),
            Application.created_at >= today_start,
        ).count()

    if today_count >= prefs.max_applications_per_day:
        console.print(f"  [yellow]Daily cap reached ({today_count}/{prefs.max_applications_per_day})[/yellow]")
        return True
    return False


def record_application(
    job_id: str, portal: str, dry_run: bool,
    filled_fields: list[str] | None = None,
    submitted: bool = False,
) -> str:
    """Record an application in the database.

    For real submissions, only marks job as 'applied' if submitted=True.
    Returns the application ID.
    """
    import json
    from src.database import record_event

    app_id = str(uuid.uuid4())
    now = datetime.now(UTC)

    with managed_session() as session:
        app = Application(
            id=app_id,
            job_id=job_id,
            applied_via=portal,
            status="dry_run" if dry_run else ("applied" if submitted else "error"),
            created_at=now,
            updated_at=now,
            is_dry_run=dry_run,
            form_responses=json.dumps({"filled_fields": filled_fields or []}),
        )
        session.add(app)

        # Update job status only for confirmed real submissions
        if not dry_run and submitted:
            job = session.get(Job, job_id)
            if job:
                job.status = "applied"
                job.applied_at = now

    # Record timeline event
    event_type = "dry_run_complete" if dry_run else ("submitted" if submitted else "error")
    record_event(app_id, job_id, event_type, {"portal": portal, "filled_fields": filled_fields or []})

    return app_id


def create_browser_page():
    """Launch a stealth Playwright browser and return (playwright, browser, context)."""
    pw = sync_playwright().start()
    browser = pw.chromium.launch(headless=False, slow_mo=100)

    # Apply stealth settings
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        locale="en-US",
        timezone_id="America/New_York",
    )

    # Mask automation signals
    context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    """)

    return pw, browser, context


def new_page_for_job(context) -> Page:
    """Create a fresh page for each job application (avoids state leaking between jobs)."""
    return context.new_page()


def fill_input_field(page: Page, selector: str, value: str, retries: int = 2) -> bool:
    """Fill an input field if it exists and is visible/enabled. Returns True if filled."""
    for attempt in range(retries):
        try:
            el = page.query_selector(selector)
            if el and el.is_visible() and el.is_enabled():
                el.click()
                human_delay(0.3, 0.7)
                el.fill(value)
                # Verify the value was set
                actual = el.input_value()
                if actual == value:
                    return True
                # Retry: clear and refill
                el.fill("")
                human_delay(0.2, 0.4)
                el.fill(value)
                return True
        except Exception:
            if attempt < retries - 1:
                human_delay(0.5, 1.0)
    return False


def detect_portal(url: str) -> str | None:
    """Detect which ATS portal a URL belongs to."""
    url_lower = url.lower()
    if "greenhouse.io" in url_lower or "boards.greenhouse" in url_lower:
        return "greenhouse"
    # Detect embedded Greenhouse via gh_jid parameter
    if "gh_jid=" in url_lower:
        return "greenhouse"
    if "lever.co" in url_lower or "jobs.lever" in url_lower:
        return "lever"
    if "myworkdayjobs.com" in url_lower or "workday.com" in url_lower:
        return "workday"
    return None
