"""Jobs API routes."""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import case, func, or_

from src.database import Job, managed_session

router = APIRouter(tags=["jobs"])


class JobOut(BaseModel):
    id: str
    title: str
    company: str
    location: str
    source: str
    url: str | None = None
    jd_text: str | None = None
    match_score: float | None = None
    ats_keywords: list[str] = []
    red_flags: list[str] = []
    recommended_action: str | None = None
    status: str | None = None
    resume_id: str | None = None
    posted_at: str | None = None
    deadline: str | None = None
    applied_at: str | None = None
    scraped_at: str | None = None
    research_notes: str | None = None
    dismissed_at: str | None = None


class StatusUpdate(BaseModel):
    status: str


VALID_STATUSES = {
    "scraped", "scored", "apply_queue", "manual_review",
    "applied", "under_review", "interview", "rejected",
    "offer", "accepted", "ghosted", "withdrawn",
}

MAX_TEXT_LENGTH = 100_000  # 100KB max for text fields


class JobUpdate(BaseModel):
    status: str | None = None
    research_notes: str | None = None
    dismissed: bool | None = None  # true to dismiss, false to restore
    jd_text: str | None = None  # set/replace the job description (manual paste)


def _safe_json_loads(raw: str | None) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _job_to_dict(j: Job) -> dict:
    return {
        "id": j.id,
        "title": j.title,
        "company": j.company,
        "location": j.location or "",
        "source": j.source,
        "url": j.url,
        "jd_text": j.jd_text,
        "match_score": j.match_score,
        "ats_keywords": _safe_json_loads(j.ats_keywords),
        "red_flags": _safe_json_loads(j.red_flags),
        "recommended_action": j.recommended_action,
        "status": j.status or "scraped",
        "resume_id": j.resume_id,
        "posted_at": j.posted_at.isoformat() if j.posted_at else None,
        "deadline": j.deadline.isoformat() if j.deadline else None,
        "applied_at": j.applied_at.isoformat() if j.applied_at else None,
        "scraped_at": j.scraped_at.isoformat() if j.scraped_at else None,
        "research_notes": j.research_notes,
        "dismissed_at": j.dismissed_at.isoformat() if j.dismissed_at else None,
    }


@router.get("/sources")
def list_sources(include_dismissed: bool = False):
    """Return aggregated stats per job source. Excludes dismissed jobs by default."""
    with managed_session() as session:
        base = session.query(Job)
        if not include_dismissed:
            base = base.filter(Job.dismissed_at.is_(None))

        # Per-source aggregates
        rows = (
            base.with_entities(
                Job.source.label("source"),
                func.count(Job.id).label("total"),
                func.sum(case((Job.match_score.isnot(None), 1), else_=0)).label("scored"),
                func.avg(Job.match_score).label("avg_score"),
                func.max(Job.scraped_at).label("last_scraped"),
            )
            .group_by(Job.source)
            .all()
        )

        # Per-source status breakdown
        status_q = session.query(Job.source, Job.status, func.count(Job.id))
        if not include_dismissed:
            status_q = status_q.filter(Job.dismissed_at.is_(None))
        status_rows = status_q.group_by(Job.source, Job.status).all()
        status_map: dict[str, dict[str, int]] = {}
        for src_name, st, count in status_rows:
            status_map.setdefault(src_name, {})[st or "scraped"] = count

        sources = []
        for r in rows:
            sources.append({
                "name": r.source,
                "total": r.total,
                "scored": int(r.scored or 0),
                "avg_score": float(r.avg_score) if r.avg_score is not None else None,
                "last_scraped": r.last_scraped.isoformat() if r.last_scraped else None,
                "by_status": status_map.get(r.source, {}),
            })
        # Sort by total desc by default
        sources.sort(key=lambda s: s["total"], reverse=True)

        total_jobs = sum(s["total"] for s in sources)

    return {"sources": sources, "total_jobs": total_jobs}


@router.get("/jobs")
def list_jobs(
    status: str | None = None,
    source: str | None = None,
    min_score: float | None = None,
    location: str | None = None,
    search: str | None = None,
    sort: str | None = None,
    order: str = "desc",
    limit: int = Query(100, le=1000),
    offset: int = 0,
    include_dismissed: bool = False,
    only_dismissed: bool = False,
    hide_expired: bool = False,
):
    with managed_session() as session:
        q = session.query(Job)

        # Dismissed filter (default: hide dismissed)
        if only_dismissed:
            q = q.filter(Job.dismissed_at.isnot(None))
        elif not include_dismissed:
            q = q.filter(Job.dismissed_at.is_(None))

        # Expired filter (deadline in the past)
        if hide_expired:
            now = datetime.now(UTC)
            q = q.filter(or_(Job.deadline.is_(None), Job.deadline >= now))

        if status:
            q = q.filter(Job.status == status)
        if source:
            q = q.filter(Job.source == source)
        if min_score is not None:
            q = q.filter(Job.match_score >= min_score)
        if location:
            q = q.filter(Job.location.ilike(f"%{location}%"))
        if search:
            q = q.filter(
                Job.title.ilike(f"%{search}%") | Job.company.ilike(f"%{search}%")
            )

        total = q.count()

        # Sorting
        sort_columns = {
            "posted_at": Job.posted_at,
            "deadline": Job.deadline,
            "scraped_at": Job.scraped_at,
            "match_score": Job.match_score,
            "company": Job.company,
            "title": Job.title,
        }
        col = sort_columns.get(sort, Job.scraped_at)
        order_clause = col.asc().nullslast() if order == "asc" else col.desc().nullslast()
        jobs = q.order_by(order_clause).offset(offset).limit(limit).all()
        result = [_job_to_dict(j) for j in jobs]

    return {"jobs": result, "total": total}


# IMPORTANT: static job paths (/jobs/duplicates, /jobs/dedupe, /jobs/bulk-dismiss)
# MUST be declared before the parametric /jobs/{job_id} route below — otherwise
# FastAPI matches "duplicates" as a job_id and returns 404.

class DedupRequest(BaseModel):
    mode: str = "strict"  # "strict" | "by_role"
    dry_run: bool = False


@router.get("/jobs/duplicates")
def get_duplicates_static(mode: str = "strict"):
    """Preview duplicate job groups without modifying anything."""
    if mode not in ("strict", "by_role"):
        raise HTTPException(status_code=400, detail="mode must be 'strict' or 'by_role'")
    from src.dedup import preview_duplicates
    return preview_duplicates(mode=mode)


@router.post("/jobs/dedupe")
def run_dedupe_static(body: DedupRequest):
    """Merge duplicate jobs. Returns counts of what was changed."""
    if body.mode not in ("strict", "by_role"):
        raise HTTPException(status_code=400, detail="mode must be 'strict' or 'by_role'")
    from src.dedup import merge_duplicates
    return merge_duplicates(mode=body.mode, dry_run=body.dry_run)


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    with managed_session() as session:
        j = session.get(Job, job_id)
        if not j:
            raise HTTPException(status_code=404, detail="Job not found")
        return _job_to_dict(j)


@router.post("/jobs/{job_id}/score")
def score_single_job(job_id: str):
    """AI-score a single job using Claude."""
    from src.ai.scorer import score_job, _validate_score, _validate_list
    from src.preferences import load_preferences

    prefs = load_preferences()
    preferences_json = json.dumps({
        "job_titles": prefs.job_titles,
        "locations": prefs.locations,
        "experience_levels": prefs.experience_levels,
        "remote_preference": prefs.remote_preference,
        "keywords_required": prefs.keywords_required,
        "keywords_excluded": prefs.keywords_excluded,
    })

    # Load resume summary
    resume_summary = ""
    try:
        from src.ai.tailor import load_master_resume
        master = load_master_resume()
        resume_summary = master.get("summary", "")
    except FileNotFoundError:
        pass

    with managed_session() as session:
        job = session.get(Job, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        if not job.jd_text:
            raise HTTPException(status_code=400, detail="Job has no description to score")

        try:
            result = score_job(job, preferences_json, resume_summary)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Scoring failed: {e}")

        job.match_score = _validate_score(result.get("match_score", 0.0))
        job.ats_keywords = json.dumps(_validate_list(result.get("ats_keywords")))
        job.red_flags = json.dumps(_validate_list(result.get("red_flags")))

        action = result.get("recommended_action", "skip")
        if action not in ("apply", "manual_review", "skip"):
            action = "skip"
        job.recommended_action = action

        if job.match_score >= prefs.min_match_score:
            job.status = "apply_queue"
        elif job.recommended_action == "manual_review":
            job.status = "manual_review"
        else:
            job.status = "scored"

        return _job_to_dict(job)


@router.patch("/jobs/{job_id}")
def update_job(job_id: str, body: JobUpdate):
    with managed_session() as session:
        j = session.get(Job, job_id)
        if not j:
            raise HTTPException(status_code=404, detail="Job not found")
        if body.status is not None:
            if body.status not in VALID_STATUSES:
                raise HTTPException(status_code=400, detail=f"Invalid status '{body.status}'. Valid: {', '.join(sorted(VALID_STATUSES))}")
            j.status = body.status
        if body.research_notes is not None:
            if len(body.research_notes) > MAX_TEXT_LENGTH:
                raise HTTPException(status_code=400, detail=f"research_notes exceeds {MAX_TEXT_LENGTH} character limit")
            j.research_notes = body.research_notes
        if body.dismissed is not None:
            j.dismissed_at = datetime.now(UTC) if body.dismissed else None
        if body.jd_text is not None:
            if len(body.jd_text) > MAX_TEXT_LENGTH:
                raise HTTPException(status_code=400, detail=f"jd_text exceeds {MAX_TEXT_LENGTH} character limit")
            cleaned = body.jd_text.strip()
            j.jd_text = cleaned or None
        result = _job_to_dict(j)
    return result


class BulkDismissRequest(BaseModel):
    job_ids: list[str] | None = None
    only_expired: bool = False  # if true, dismiss every job whose deadline has passed
    only_status: str | None = None  # optional: limit by status (e.g. only apply_queue)


@router.post("/jobs/bulk-dismiss")
def bulk_dismiss(body: BulkDismissRequest):
    """Dismiss many jobs at once. Useful for sweeping expired jobs out of the queue."""
    now = datetime.now(UTC)
    with managed_session() as session:
        q = session.query(Job).filter(Job.dismissed_at.is_(None))
        if body.job_ids:
            q = q.filter(Job.id.in_(body.job_ids))
        if body.only_expired:
            q = q.filter(Job.deadline.isnot(None)).filter(Job.deadline < now)
        if body.only_status:
            q = q.filter(Job.status == body.only_status)
        if not (body.job_ids or body.only_expired):
            raise HTTPException(status_code=400, detail="Specify job_ids or only_expired=true")

        count = 0
        for j in q.all():
            j.dismissed_at = now
            count += 1

    return {"dismissed": count}


class LocationDismissRequest(BaseModel):
    patterns: list[str]
    dry_run: bool = False


@router.post("/jobs/dismiss-by-location")
def dismiss_by_location(body: LocationDismissRequest):
    """Dismiss every active job whose location matches any of the patterns.
    Long patterns use substring; short ones (≤3 chars) use word boundaries.
    Use dry_run=true to preview.
    """
    from src.location_match import first_matching_pattern

    patterns = [p for p in body.patterns if p and p.strip()]
    if not patterns:
        raise HTTPException(status_code=400, detail="patterns must be a non-empty list")

    now = datetime.now(UTC)
    matched: list[dict] = []

    with managed_session() as session:
        candidates = (
            session.query(Job)
            .filter(Job.dismissed_at.is_(None))
            .filter(Job.location.isnot(None))
            .all()
        )
        for j in candidates:
            hit = first_matching_pattern(j.location, patterns)
            if not hit:
                continue
            matched.append({
                "id": j.id,
                "company": j.company,
                "title": j.title,
                "location": j.location,
                "matched_pattern": hit,
            })
            if not body.dry_run:
                j.dismissed_at = now

        if body.dry_run:
            session.rollback()

    return {
        "dry_run": body.dry_run,
        "matched_count": len(matched),
        "samples": matched[:25],
    }
