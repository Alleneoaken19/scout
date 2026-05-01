"""Applications, stats, funnel, and timeline API routes."""

import json
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from src.database import Application, ApplicationEvent, Job, managed_session

router = APIRouter(tags=["applications"])


def _safe_json_loads(raw: str | None, default=None):
    if default is None:
        default = {}
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


@router.get("/applications")
def list_applications():
    with managed_session() as session:
        apps = (
            session.query(Application)
            .filter(Application.is_dry_run.is_(False))
            .order_by(Application.created_at.desc())
            .all()
        )
        result = []
        for a in apps:
            job = session.get(Job, a.job_id)
            result.append({
                "id": a.id,
                "job_id": a.job_id,
                "company": job.company if job else "",
                "title": job.title if job else "",
                "location": job.location if job else "",
                "source": job.source if job else "",
                "applied_via": a.applied_via,
                "status": a.status,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "first_response_at": a.first_response_at.isoformat() if a.first_response_at else None,
                "last_email_at": a.last_email_at.isoformat() if a.last_email_at else None,
                "interview_at": a.interview_at.isoformat() if a.interview_at else None,
                "offer_at": a.offer_at.isoformat() if a.offer_at else None,
                "rejected_at": a.rejected_at.isoformat() if a.rejected_at else None,
                "email_count": a.email_count or 0,
                "notes": a.notes,
                "match_score": job.match_score if job else None,
                "url": job.url if job else None,
            })
    return {"applications": result}


@router.get("/applications/{app_id}/timeline")
def get_application_timeline(app_id: str):
    """Get the full event timeline for an application."""
    with managed_session() as session:
        app = session.get(Application, app_id)
        if not app:
            raise HTTPException(status_code=404, detail="Application not found")

        events = (
            session.query(ApplicationEvent)
            .filter(ApplicationEvent.application_id == app_id)
            .order_by(ApplicationEvent.timestamp.asc())
            .all()
        )

        job = session.get(Job, app.job_id)

        timeline = []
        for e in events:
            timeline.append({
                "event_type": e.event_type,
                "timestamp": e.timestamp.isoformat() if e.timestamp else None,
                "details": _safe_json_loads(e.details),
                "source": e.source,
            })

        return {
            "application_id": app_id,
            "company": job.company if job else "",
            "title": job.title if job else "",
            "status": app.status,
            "created_at": app.created_at.isoformat() if app.created_at else None,
            "timeline": timeline,
        }


@router.get("/stats")
def get_stats():
    with managed_session() as session:
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

        # Base query: exclude dismissed jobs from all dashboard stats
        def base():
            return session.query(Job).filter(Job.dismissed_at.is_(None))

        total = base().count()
        scraped_today = base().filter(Job.scraped_at >= today_start).count()
        scored = base().filter(Job.match_score.isnot(None)).count()
        unscored = base().filter(Job.match_score.is_(None)).count()
        applied = base().filter(Job.status == "applied").count()
        interviews = base().filter(Job.status == "interview").count()
        offers = base().filter(Job.status == "offer").count()
        rejected = base().filter(Job.status == "rejected").count()
        ghosted = base().filter(Job.status == "ghosted").count()
        apply_queue = base().filter(Job.status == "apply_queue").count()
        manual_review = base().filter(Job.status == "manual_review").count()

        # Expired jobs in the active queue (deadline passed)
        now = datetime.now(UTC)
        expired_in_queue = (
            base()
            .filter(Job.status.in_(["apply_queue", "manual_review"]))
            .filter(Job.deadline.isnot(None))
            .filter(Job.deadline < now)
            .count()
        )

        # Source breakdown
        sources = {}
        for row in session.query(Job.source).distinct().all():
            src = row[0]
            sources[src] = base().filter(Job.source == src).count()

        # Status breakdown
        statuses = {}
        for s in ["scraped", "scored", "apply_queue", "manual_review", "applied",
                  "under_review", "interview", "offer", "rejected", "ghosted"]:
            statuses[s] = base().filter(Job.status == s).count()

        # Conversion funnel
        total_or_1 = total or 1
        applied_or_1 = applied or 1
        interviews_or_1 = interviews or 1
        funnel = {
            "scraped": total,
            "scored": scored,
            "apply_queue": apply_queue,
            "applied": applied,
            "interviews": interviews,
            "offers": offers,
            "rejected": rejected,
            "ghosted": ghosted,
            "rates": {
                "score_rate": round(scored / total_or_1, 3),
                "apply_rate": round(applied / total_or_1, 3),
                "interview_rate": round(interviews / applied_or_1, 3),
                "offer_rate": round(offers / interviews_or_1, 3),
                "rejection_rate": round(rejected / applied_or_1, 3),
                "ghost_rate": round(ghosted / applied_or_1, 3),
            },
        }

        # Response metrics from Application records
        real_apps = session.query(Application).filter(Application.is_dry_run.is_(False)).all()
        total_apps = len(real_apps)
        responded = sum(1 for a in real_apps if a.first_response_at)
        response_rate = round(responded / (total_apps or 1), 3)

        # Average days to first response
        response_days = []
        for a in real_apps:
            if a.first_response_at and a.created_at:
                delta = (a.first_response_at - a.created_at).days
                if delta >= 0:
                    response_days.append(delta)
        avg_response_days = round(sum(response_days) / len(response_days), 1) if response_days else None

        # Source performance
        source_perf = {}
        for src_name, src_count in sources.items():
            src_applied = session.query(Job).filter(Job.source == src_name, Job.status == "applied").count()
            src_interviews = session.query(Job).filter(Job.source == src_name, Job.status == "interview").count()
            src_offers = session.query(Job).filter(Job.source == src_name, Job.status == "offer").count()
            source_perf[src_name] = {
                "total": src_count,
                "applied": src_applied,
                "interviews": src_interviews,
                "offers": src_offers,
                "apply_rate": round(src_applied / (src_count or 1), 3),
            }

    return {
        "total": total,
        "scraped_today": scraped_today,
        "scored": scored,
        "unscored": unscored,
        "applied": applied,
        "interviews": interviews,
        "offers": offers,
        "rejected": rejected,
        "ghosted": ghosted,
        "apply_queue": apply_queue,
        "manual_review": manual_review,
        "expired_in_queue": expired_in_queue,
        "sources": sources,
        "statuses": statuses,
        "funnel": funnel,
        "response_metrics": {
            "total_applications": total_apps,
            "responded": responded,
            "response_rate": response_rate,
            "avg_response_days": avg_response_days,
        },
        "source_performance": source_perf,
    }


@router.get("/stats/scoring-accuracy")
def get_scoring_accuracy():
    """Correlate AI match_score with actual application outcomes.

    Returns score distributions per outcome, helping measure if scoring is
    actually predictive. High scores should correlate with interviews/offers.
    """
    with managed_session() as session:
        # Get jobs that have reached a terminal state (applied and got a result)
        terminal_statuses = {"interview", "offer", "rejected", "ghosted"}
        jobs = (
            session.query(Job)
            .filter(Job.match_score.isnot(None))
            .filter(Job.status.in_(terminal_statuses | {"applied", "under_review"}))
            .all()
        )

        if not jobs:
            return {
                "total_tracked": 0,
                "message": "No applications with outcomes yet. Apply to jobs and track results.",
                "outcome_scores": {},
                "accuracy": None,
            }

        # Group scores by outcome
        outcome_scores: dict[str, list[float]] = {}
        for j in jobs:
            status = j.status or "unknown"
            if status not in outcome_scores:
                outcome_scores[status] = []
            outcome_scores[status].append(j.match_score)

        # Calculate stats per outcome
        outcome_stats = {}
        for status, scores in outcome_scores.items():
            outcome_stats[status] = {
                "count": len(scores),
                "avg_score": round(sum(scores) / len(scores), 3),
                "min_score": round(min(scores), 3),
                "max_score": round(max(scores), 3),
            }

        # Calculate overall accuracy signal:
        # "Positive" outcomes (interview, offer) should have higher avg score
        # than "negative" outcomes (rejected, ghosted)
        positive = outcome_scores.get("interview", []) + outcome_scores.get("offer", [])
        negative = outcome_scores.get("rejected", []) + outcome_scores.get("ghosted", [])

        accuracy = None
        if positive and negative:
            avg_positive = sum(positive) / len(positive)
            avg_negative = sum(negative) / len(negative)
            accuracy = {
                "avg_positive_score": round(avg_positive, 3),
                "avg_negative_score": round(avg_negative, 3),
                "score_is_predictive": avg_positive > avg_negative,
                "signal_strength": round(avg_positive - avg_negative, 3),
            }

        return {
            "total_tracked": len(jobs),
            "outcome_scores": outcome_stats,
            "accuracy": accuracy,
        }
