"""Scheduler API routes — daemon control + on-demand job triggers."""

import subprocess
import sys
import threading
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.scheduler import (
    LOG_PATH,
    PID_PATH,
    is_daemon_running,
    job_email_sync,
    job_ghosted_check,
    job_notion_sync,
    job_score,
    job_scrape,
    job_sheets_export,
    stop_daemon,
)

router = APIRouter(tags=["scheduler"])

# Track running background jobs with their status
_job_states: dict[str, dict] = {}
_running_lock = threading.Lock()

JOBS_INFO = [
    {"id": "scrape", "name": "Scrape all sources", "schedule": "Every 6 hours", "description": "Run all 15 scrapers to find new jobs"},
    {"id": "score", "name": "AI score new jobs", "schedule": "5 min after scrape", "description": "Score unscored jobs with Claude Haiku"},
    {"id": "email_sync", "name": "Gmail email sync", "schedule": "Every 2 hours", "description": "Scan inbox for application status updates"},
    {"id": "ghosted_check", "name": "Ghosted check", "schedule": "Daily 9:00", "description": "Flag applications with 21+ days no response"},
    {"id": "notion_sync", "name": "Notion sync", "schedule": "Every 30 min", "description": "Sync job pipeline to Notion database"},
    {"id": "sheets_export", "name": "Sheets export", "schedule": "Daily 23:00", "description": "Export applications to Google Sheets"},
    {"id": "daily_summary", "name": "Daily summary", "schedule": "Daily 9:30", "description": "Desktop notification with daily stats"},
]

# Map job IDs to their functions (for on-demand runs)
_JOB_FUNCTIONS = {
    "scrape": job_scrape,
    "score": job_score,
    "email_sync": job_email_sync,
    "ghosted_check": job_ghosted_check,
    "notion_sync": job_notion_sync,
    "sheets_export": job_sheets_export,
}


class RunJobRequest(BaseModel):
    job_id: str


@router.get("/scheduler/status")
def scheduler_status():
    with _running_lock:
        running_jobs = {
            jid: state["started_at"]
            for jid, state in _job_states.items()
            if state.get("status") == "running"
        }
    return {
        "running": is_daemon_running(),
        "pid": _read_pid(),
        "running_jobs": {k: v.isoformat() for k, v in running_jobs.items()},
    }


@router.post("/scheduler/start")
def start_scheduler():
    """Start the daemon as a background subprocess."""
    if is_daemon_running():
        return {"status": "already_running", "pid": _read_pid()}

    try:
        # Start daemon as a detached subprocess using the same Python interpreter
        proc = subprocess.Popen(
            [sys.executable, "-c", "from src.scheduler import start_daemon; start_daemon()"],
            stdout=open(str(LOG_PATH), "a"),
            stderr=subprocess.STDOUT,
            start_new_session=True,  # Detach from parent
        )
        # Give it a moment to write PID
        proc.poll()
        return {"status": "started", "pid": proc.pid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start daemon: {e}")


@router.post("/scheduler/stop")
def stop_scheduler():
    """Stop the running daemon."""
    if not is_daemon_running():
        return {"status": "not_running"}

    if stop_daemon():
        return {"status": "stopped"}
    raise HTTPException(status_code=500, detail="Failed to stop daemon")


@router.post("/scheduler/run")
def run_job_now(body: RunJobRequest):
    """Trigger a scheduled job to run immediately in a background thread."""
    job_fn = _JOB_FUNCTIONS.get(body.job_id)
    if not job_fn:
        raise HTTPException(status_code=400, detail=f"Unknown job: {body.job_id}. Available: {list(_JOB_FUNCTIONS.keys())}")

    with _running_lock:
        state = _job_states.get(body.job_id)
        if state and state.get("status") == "running":
            return {"status": "already_running", "job_id": body.job_id, "started_at": state["started_at"].isoformat()}

    def _run_in_background():
        with _running_lock:
            _job_states[body.job_id] = {
                "status": "running",
                "started_at": datetime.now(UTC),
                "finished_at": None,
                "error": None,
            }
        try:
            job_fn()
            with _running_lock:
                _job_states[body.job_id]["status"] = "completed"
                _job_states[body.job_id]["finished_at"] = datetime.now(UTC)
        except Exception as e:
            with _running_lock:
                _job_states[body.job_id]["status"] = "failed"
                _job_states[body.job_id]["finished_at"] = datetime.now(UTC)
                _job_states[body.job_id]["error"] = str(e)
            # Also log it so it appears in the log viewer
            from src.scheduler import _log
            _log(f"{body.job_id} failed: {e}")

    thread = threading.Thread(target=_run_in_background, daemon=True)
    thread.start()

    return {"status": "started", "job_id": body.job_id}


@router.get("/scheduler/jobs")
def scheduler_jobs():
    with _running_lock:
        states = dict(_job_states)

    jobs = []
    for j in JOBS_INFO:
        state = states.get(j["id"])
        job_info = {
            **j,
            "is_running": state is not None and state.get("status") == "running",
            "last_status": state.get("status") if state else None,
            "last_error": state.get("error") if state else None,
            "last_finished_at": state["finished_at"].isoformat() if state and state.get("finished_at") else None,
        }
        jobs.append(job_info)
    return {"jobs": jobs}


@router.get("/scheduler/log")
def scheduler_log(lines: int = 100):
    if not LOG_PATH.exists():
        return {"log": []}
    all_lines = LOG_PATH.read_text().splitlines()
    return {"log": all_lines[-lines:]}


def _read_pid() -> int | None:
    if PID_PATH.exists():
        try:
            return int(PID_PATH.read_text().strip())
        except (ValueError, OSError):
            pass
    return None
