"""APScheduler daemon -- runs all Scout jobs on cron schedule."""

import fcntl
import logging
import os
import signal
import sys
from datetime import UTC, datetime

from apscheduler.schedulers.blocking import BlockingScheduler
from rich.console import Console

from src.paths import DATA_DIR

console = Console()

LOG_PATH = DATA_DIR / "scout.log"
PID_PATH = DATA_DIR / "daemon.pid"
LOCK_PATH = DATA_DIR / "daemon.lock"


def _setup_logging() -> None:
    """Configure logging to file."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(LOG_PATH),
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _log(msg: str) -> None:
    """Log to file and print."""
    logging.info(msg)
    console.print(f"  [dim]{datetime.now(UTC).strftime('%H:%M:%S')}[/dim] {msg}")


def job_scrape() -> None:
    """Scheduled: scrape all sources."""
    _log("Starting scheduled scrape...")
    try:
        from src.scrapers.arbeitnow import scrape_arbeitnow
        from src.scrapers.greenhouse import scrape_greenhouse_boards
        from src.scrapers.himalayas import scrape_himalayas
        from src.scrapers.jobicy import scrape_jobicy
        from src.scrapers.landingjobs import scrape_landingjobs
        from src.scrapers.remoteok import scrape_remoteok
        from src.scrapers.remotive import scrape_remotive
        from src.scrapers.themuse import scrape_themuse
        from src.scrapers.weworkremotely import scrape_weworkremotely
        from src.scrapers.workingnomads import scrape_workingnomads
        from src.preferences import load_preferences

        prefs = load_preferences()

        # General scrapers — work for any profession
        scraper_list = [
            ("Arbeitnow", scrape_arbeitnow),
            ("RemoteOK", scrape_remoteok),
            ("Remotive", scrape_remotive),
            ("WeWorkRemotely", scrape_weworkremotely),
            ("Himalayas", scrape_himalayas),
            ("Jobicy", scrape_jobicy),
            ("Greenhouse", scrape_greenhouse_boards),
            ("Landing.jobs", scrape_landingjobs),
            ("TheMuse", scrape_themuse),
            ("WorkingNomads", scrape_workingnomads),
        ]

        # Tech-specific scrapers — only if user has tech job titles
        _tech_words = {"software", "developer", "engineer", "android", "ios",
                       "mobile", "frontend", "backend", "fullstack", "devops",
                       "data", "ml", "ai", "cloud", "sre", "web", "react",
                       "python", "java", "kotlin", "flutter", "kmp"}
        has_tech = any(
            any(w in t.lower().split() for w in _tech_words)
            for t in prefs.job_titles
        )
        if has_tech:
            from src.scrapers.androidjobs import scrape_androidjobs
            from src.scrapers.echojobs import scrape_echojobs
            from src.scrapers.hn_hiring import scrape_hn_hiring
            scraper_list.extend([
                ("AndroidJobs", scrape_androidjobs),
                ("EchoJobs", scrape_echojobs),
                ("HN Hiring", scrape_hn_hiring),
            ])

        total_new = 0
        total_filtered = 0
        failed_scrapers = []
        for name, scraper in scraper_list:
            try:
                new, _, filt = scraper()
                total_new += new
                total_filtered += filt
                _log(f"  {name}: +{new} new, {filt} filtered")
            except Exception as e:
                failed_scrapers.append(name)
                _log(f"  {name} error: {e}")
                logging.exception(f"Scraper {name} traceback:")

        summary = f"Scrape complete: {total_new} new jobs, {total_filtered} filtered out"
        if failed_scrapers:
            summary += f", {len(failed_scrapers)} failed: {', '.join(failed_scrapers)}"
        _log(summary)
    except Exception as e:
        _log(f"Scrape error: {e}")


def job_score() -> None:
    """Scheduled: score unscored jobs (runs 5 min after scrape)."""
    _log("Starting scheduled scoring...")
    try:
        from src.ai.scorer import score_all_unscored
        from src.ai.tailor import load_master_resume
        master = load_master_resume()
        scored, above, errors, pre_filtered = score_all_unscored(master.get("summary", ""), limit=50)
        _log(f"Scoring complete: {scored} scored, {above} above threshold, {pre_filtered} auto-skipped, {errors} errors")
    except Exception as e:
        _log(f"Score error: {e}")


def job_email_sync() -> None:
    """Scheduled: sync Gmail for application status emails."""
    _log("Starting email sync...")
    try:
        from src.tracking.gmail_reader import sync_emails
        processed, updated = sync_emails()
        _log(f"Email sync complete: {processed} processed, {updated} updated")
    except Exception as e:
        _log(f"Email sync error: {e}")


def job_ghosted_check() -> None:
    """Scheduled: flag applications with no reply in 21 days."""
    _log("Running ghosted detector...")
    try:
        from src.tracking.gmail_reader import detect_ghosted
        count = detect_ghosted()
        _log(f"Ghosted check complete: {count} flagged")
    except Exception as e:
        _log(f"Ghosted check error: {e}")


def job_notion_sync() -> None:
    """Scheduled: sync to Notion."""
    _log("Starting Notion sync...")
    try:
        from src.integrations.notion_sync import sync_to_notion
        created, updated = sync_to_notion()
        _log(f"Notion sync complete: {created} created, {updated} updated")
    except Exception as e:
        _log(f"Notion sync error: {e}")


def job_sheets_export() -> None:
    """Scheduled: export to Google Sheets."""
    _log("Starting Sheets export...")
    try:
        from src.integrations.sheets_sync import sync_to_sheets
        rows = sync_to_sheets()
        _log(f"Sheets export complete: {rows} rows")
    except Exception as e:
        _log(f"Sheets export error: {e}")


def job_daily_summary() -> None:
    """Scheduled: send daily summary notification."""
    try:
        from src.database import Job, managed_session
        with managed_session() as session:
            today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

            scraped_today = session.query(Job).filter(Job.scraped_at >= today_start).count()
            scored = session.query(Job).filter(Job.match_score.isnot(None)).count()
            applied = session.query(Job).filter(Job.status == "applied").count()
            interviews = session.query(Job).filter(Job.status == "interview").count()

        msg = f"Scraped: {scraped_today} | Scored: {scored} | Applied: {applied} | Interviews: {interviews}"
        _log(f"Daily summary: {msg}")

        try:
            from plyer import notification
            notification.notify(
                title="Scout -- Daily Summary",
                message=msg,
                timeout=10,
            )
        except Exception:
            pass
    except Exception as e:
        _log(f"Daily summary error: {e}")


def _acquire_lock() -> int | None:
    """Acquire exclusive file lock to prevent multiple daemon instances.
    Returns the file descriptor if acquired, None if already locked."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(LOCK_PATH), os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Write PID atomically
        os.ftruncate(fd, 0)
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, str(os.getpid()).encode())
        return fd
    except OSError:
        os.close(fd)
        return None


def start_daemon() -> None:
    """Start the background scheduler daemon."""
    _setup_logging()

    # Acquire exclusive lock to prevent multiple instances
    lock_fd = _acquire_lock()
    if lock_fd is None:
        console.print("[red]Daemon is already running (lock file held)[/red]")
        sys.exit(1)

    _log("Daemon starting...")

    # Write PID file for status checks
    PID_PATH.write_text(str(os.getpid()))

    scheduler = BlockingScheduler()

    # max_instances=1 prevents job overlap if a previous run is still executing
    scheduler.add_job(job_scrape, "interval", hours=6, id="scrape",
                      max_instances=1, next_run_time=None)
    scheduler.add_job(job_score, "interval", hours=6, minutes=5, id="score",
                      max_instances=1, next_run_time=None)
    scheduler.add_job(job_email_sync, "interval", hours=2, id="email_sync",
                      max_instances=1)
    scheduler.add_job(job_ghosted_check, "cron", hour=9, id="ghosted_check",
                      max_instances=1)
    scheduler.add_job(job_notion_sync, "interval", minutes=30, id="notion_sync",
                      max_instances=1, next_run_time=None)
    scheduler.add_job(job_sheets_export, "cron", hour=23, id="sheets_export",
                      max_instances=1)
    scheduler.add_job(job_daily_summary, "cron", hour=9, minute=30, id="daily_summary",
                      max_instances=1)

    def shutdown(signum, frame):
        _log("Daemon stopping...")
        scheduler.shutdown(wait=False)
        PID_PATH.unlink(missing_ok=True)
        if lock_fd is not None:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)
        LOCK_PATH.unlink(missing_ok=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    _log("Daemon running. Scheduled jobs:")
    for job in scheduler.get_jobs():
        _log(f"  {job.id}: {job.trigger}")

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        PID_PATH.unlink(missing_ok=True)
        if lock_fd is not None:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)
        LOCK_PATH.unlink(missing_ok=True)


def stop_daemon() -> bool:
    """Stop the running daemon. Returns True if stopped."""
    if not PID_PATH.exists():
        return False

    try:
        pid = int(PID_PATH.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        PID_PATH.unlink(missing_ok=True)
        return True
    except (ProcessLookupError, ValueError):
        PID_PATH.unlink(missing_ok=True)
        return False


def is_daemon_running() -> bool:
    """Check if daemon is currently running."""
    if not PID_PATH.exists():
        return False
    try:
        pid = int(PID_PATH.read_text().strip())
        os.kill(pid, 0)  # Check if process exists
        return True
    except (ProcessLookupError, ValueError, PermissionError):
        PID_PATH.unlink(missing_ok=True)
        return False
