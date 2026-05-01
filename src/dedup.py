"""Job deduplication — find and merge duplicate Job rows.

Two duplicate categories show up in practice:

1. **True duplicates** — same (company, title, location) but different IDs.
   Caused by a historical bug in `job_hash()` that included the scraper's
   URL in the SHA, so unique tracking params per scrape produced fresh
   hashes for identical jobs. Fixed at the source going forward; this
   module cleans the existing rows.

2. **Multi-location variants** — same (company, title) posted across
   several cities (NYC, SF, Chicago, Remote, …). Technically different rows
   per the schema, but for the user's pipeline they're the same opportunity.
   Opt-in via mode="by_role".

Canonical selection:
- Pick the row furthest along the workflow (interview > offer > applied >
  apply_queue > manual_review > scored > scraped > rejected/ghosted).
- Tiebreak on has-resume, then earliest scraped_at, then lex id.

Merge behavior:
- Union of textual data (longest jd_text, best URL, etc.).
- Multi-location merges concatenate distinct locations into a single
  comma-separated string on the canonical row.
- Resume / Application / ApplicationEvent rows are reassigned to the
  canonical id BEFORE the loser rows are deleted (so the cascade
  doesn't take real work with it).
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Literal

from sqlalchemy.orm import Session

from src.database import (
    Application,
    ApplicationEvent,
    Job,
    Resume,
    managed_session,
)

DedupMode = Literal["strict", "by_role"]


# Higher value = further along in the workflow / more important to preserve
_STATUS_PRIORITY = {
    "offer": 100,
    "interview": 90,
    "applied": 80,
    "apply_queue": 70,
    "manual_review": 60,
    "scored": 50,
    "scraped": 40,
    "ghosted": 30,
    "rejected": 20,
}


def _normalize(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.strip().lower())


def _aggregator_score(url: str | None) -> int:
    """Lower is better. 0 = direct company URL; 1 = aggregator."""
    if not url:
        return 2
    aggregators = (
        "indeed.com", "linkedin.com", "glassdoor.com", "ziprecruiter.com",
        "remoteok.com", "arbeitnow.com", "stackoverflow.com",
        "wellfound.com", "simplyhired.com", "angel.co",
    )
    return 1 if any(d in url for d in aggregators) else 0


def _job_score(j: Job) -> tuple:
    """Sort key: higher status priority first, has-resume preferred,
    earliest-scraped preferred, then lex id for stable tiebreak."""
    return (
        -_STATUS_PRIORITY.get(j.status or "scraped", 0),
        0 if j.resume_id else 1,
        j.scraped_at or "",
        j.id,
    )


def _group_key(j: Job, mode: DedupMode) -> tuple:
    if mode == "by_role":
        return (_normalize(j.company), _normalize(j.title))
    return (_normalize(j.company), _normalize(j.title), _normalize(j.location))


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def find_duplicate_groups(
    session: Session,
    mode: DedupMode = "strict",
    include_dismissed: bool = False,
) -> list[list[Job]]:
    """Return a list of duplicate groups (each group has ≥2 jobs).

    Within each group the canonical row is first; the rest are losers
    that would be merged into it.
    """
    q = session.query(Job)
    if not include_dismissed:
        q = q.filter(Job.dismissed_at.is_(None))
    all_jobs = q.all()

    groups: dict[tuple, list[Job]] = defaultdict(list)
    for j in all_jobs:
        groups[_group_key(j, mode)].append(j)

    duplicates: list[list[Job]] = []
    for group in groups.values():
        if len(group) < 2:
            continue
        group.sort(key=_job_score)
        duplicates.append(group)

    # Sort groups by losing-count desc so the noisiest groups appear first
    duplicates.sort(key=lambda g: len(g), reverse=True)
    return duplicates


def preview_duplicates(mode: DedupMode = "strict") -> dict:
    """Return a JSON-serializable preview suitable for the UI/CLI."""
    with managed_session() as session:
        groups = find_duplicate_groups(session, mode=mode)
        out_groups = []
        total_losers = 0
        for g in groups:
            canonical, *losers = g
            total_losers += len(losers)
            out_groups.append({
                "canonical": _summarize(canonical),
                "losers": [_summarize(j) for j in losers],
                "loser_count": len(losers),
            })
        return {
            "mode": mode,
            "group_count": len(out_groups),
            "duplicate_count": total_losers,
            "groups": out_groups,
        }


def _summarize(j: Job) -> dict:
    return {
        "id": j.id,
        "company": j.company,
        "title": j.title,
        "location": j.location,
        "source": j.source,
        "status": j.status,
        "match_score": j.match_score,
        "has_resume": bool(j.resume_id),
        "scraped_at": j.scraped_at.isoformat() if j.scraped_at else None,
    }


# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------

def _merge_into_canonical(canonical: Job, loser: Job, mode: DedupMode) -> None:
    """Pull richer data from `loser` onto `canonical` (in-place)."""

    # JD text — keep the longest
    if loser.jd_text and len(loser.jd_text) > len(canonical.jd_text or ""):
        canonical.jd_text = loser.jd_text

    # URL — prefer direct company URLs over aggregators
    if loser.url:
        if not canonical.url or _aggregator_score(loser.url) < _aggregator_score(canonical.url):
            canonical.url = loser.url

    # Earliest scraped_at, latest applied_at
    if loser.scraped_at and (not canonical.scraped_at or loser.scraped_at < canonical.scraped_at):
        canonical.scraped_at = loser.scraped_at
    if loser.applied_at and (not canonical.applied_at or loser.applied_at > canonical.applied_at):
        canonical.applied_at = loser.applied_at
    if loser.posted_at and not canonical.posted_at:
        canonical.posted_at = loser.posted_at
    if loser.deadline and not canonical.deadline:
        canonical.deadline = loser.deadline

    # Score: keep the higher (more confident scoring)
    if loser.match_score is not None and (
        canonical.match_score is None or loser.match_score > canonical.match_score
    ):
        canonical.match_score = loser.match_score
        canonical.ats_keywords = loser.ats_keywords
        canonical.red_flags = loser.red_flags
        canonical.recommended_action = loser.recommended_action

    # Research notes — concatenate if both exist
    if loser.research_notes:
        if canonical.research_notes:
            if loser.research_notes.strip() not in canonical.research_notes:
                canonical.research_notes = (
                    canonical.research_notes.rstrip()
                    + "\n\n---\n\n"
                    + loser.research_notes.strip()
                )
        else:
            canonical.research_notes = loser.research_notes

    # Multi-location: keep distinct locations on the canonical row
    if mode == "by_role" and loser.location:
        existing = [
            loc.strip()
            for loc in (canonical.location or "").split(",")
            if loc.strip()
        ]
        for loc in loser.location.split(","):
            loc = loc.strip()
            if loc and loc.lower() not in {e.lower() for e in existing}:
                existing.append(loc)
        canonical.location = ", ".join(existing)


def _migrate_references(session: Session, from_id: str, to_id: str) -> dict:
    """Move FK references from a loser job_id to the canonical id.

    Returns a dict with counts per table.
    """
    counts = {"resumes": 0, "applications": 0, "events": 0}

    # Resumes — only one tailored resume per job in practice, but be safe
    for r in session.query(Resume).filter(Resume.job_id == from_id).all():
        # Don't clobber an existing canonical resume; skip if canonical has one
        existing = session.query(Resume).filter(Resume.job_id == to_id).first()
        if existing:
            session.delete(r)
        else:
            r.job_id = to_id
        counts["resumes"] += 1

    for a in session.query(Application).filter(Application.job_id == from_id).all():
        a.job_id = to_id
        counts["applications"] += 1

    for ev in session.query(ApplicationEvent).filter(
        ApplicationEvent.job_id == from_id
    ).all():
        ev.job_id = to_id
        counts["events"] += 1

    return counts


def merge_duplicates(mode: DedupMode = "strict", dry_run: bool = False) -> dict:
    """Find and merge duplicate jobs. Returns a summary."""
    with managed_session() as session:
        groups = find_duplicate_groups(session, mode=mode)

        merged_groups = 0
        deleted_jobs = 0
        migrated = {"resumes": 0, "applications": 0, "events": 0}

        for group in groups:
            canonical, *losers = group
            for loser in losers:
                _merge_into_canonical(canonical, loser, mode)
                if not dry_run:
                    counts = _migrate_references(session, loser.id, canonical.id)
                    for k in migrated:
                        migrated[k] += counts[k]
                    session.delete(loser)
                deleted_jobs += 1
            merged_groups += 1

        if dry_run:
            session.rollback()  # discard merge field changes too

        return {
            "mode": mode,
            "dry_run": dry_run,
            "groups_processed": merged_groups,
            "jobs_removed": deleted_jobs,
            "references_migrated": migrated,
        }
