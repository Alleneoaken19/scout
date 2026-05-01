"""Data management API — export and deletion for privacy compliance."""

import json
import shutil
from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from src.database import Application, ApplicationEvent, Job, managed_session
from src.paths import CONFIG_DIR, DATA_DIR, RESUME_DIR

router = APIRouter(tags=["data-management"])


@router.get("/data/export")
def export_all_data():
    """Export all user data as JSON (GDPR Article 20 — right to data portability)."""
    with managed_session() as session:
        jobs = session.query(Job).all()
        apps = session.query(Application).all()
        events = session.query(ApplicationEvent).all()

    # Read master resume
    master_resume = {}
    master_path = RESUME_DIR / "master.json"
    if master_path.exists():
        try:
            master_resume = json.loads(master_path.read_text())
        except (json.JSONDecodeError, OSError):
            pass

    # Read preferences
    preferences = {}
    prefs_path = CONFIG_DIR / "preferences.yaml"
    if prefs_path.exists():
        try:
            import yaml
            preferences = yaml.safe_load(prefs_path.read_text()) or {}
        except Exception:
            pass

    export = {
        "exported_at": datetime.now(UTC).isoformat(),
        "master_resume": master_resume,
        "preferences": preferences,
        "jobs": [
            {
                "id": j.id,
                "title": j.title,
                "company": j.company,
                "location": j.location,
                "source": j.source,
                "url": j.url,
                "status": j.status,
                "match_score": j.match_score,
                "scraped_at": j.scraped_at.isoformat() if j.scraped_at else None,
            }
            for j in jobs
        ],
        "applications": [
            {
                "id": a.id,
                "job_id": a.job_id,
                "portal": a.portal,
                "status": a.status,
                "is_dry_run": a.is_dry_run,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in apps
        ],
        "application_events": [
            {
                "id": e.id,
                "application_id": e.application_id,
                "event_type": e.event_type,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
    }

    return JSONResponse(content=export)


@router.delete("/data/delete-all")
def delete_all_data():
    """Delete all user data (GDPR Article 17 — right to erasure).

    This permanently deletes:
    - All jobs, applications, and events from the database
    - Generated resumes
    - Cached form answers
    - Application logs

    It does NOT delete:
    - Master resume (resume/master.json)
    - Preferences (config/preferences.yaml)
    - AI provider settings
    """
    deleted = {"jobs": 0, "applications": 0, "events": 0, "files": []}

    with managed_session() as session:
        deleted["events"] = session.query(ApplicationEvent).delete()
        deleted["applications"] = session.query(Application).delete()
        deleted["jobs"] = session.query(Job).delete()

    # Delete generated resumes
    generated_dir = RESUME_DIR / "generated"
    if generated_dir.exists():
        shutil.rmtree(str(generated_dir), ignore_errors=True)
        generated_dir.mkdir(parents=True, exist_ok=True)
        deleted["files"].append("resume/generated/")

    # Delete cached form answers
    answers_dir = CONFIG_DIR / "answers"
    if answers_dir.exists():
        shutil.rmtree(str(answers_dir), ignore_errors=True)
        answers_dir.mkdir(parents=True, exist_ok=True)
        deleted["files"].append("config/answers/")

    # Delete application log
    log_path = DATA_DIR / "apply_log.jsonl"
    if log_path.exists():
        log_path.unlink()
        deleted["files"].append("data/apply_log.jsonl")

    return {
        "status": "deleted",
        "deleted_at": datetime.now(UTC).isoformat(),
        "summary": deleted,
    }
