"""Shared scraper utilities -- hashing and dedup insertion."""

import hashlib
import re
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from src.database import Job


def _normalize_whitespace(text: str) -> str:
    """Collapse multiple whitespace chars to single space."""
    return re.sub(r"\s+", " ", text.strip().lower())


def job_hash(company: str, title: str, location: str, url: str = "") -> str:
    """SHA256 hash of company+title+location for deduplication.

    NOTE: `url` is intentionally ignored. Indeed/LinkedIn aggregator URLs
    contain unique tracking parameters per scrape (?from=…&jk=…), so
    including them would defeat dedup — the same job would get a fresh hash
    on every run. The signature is kept for backward compatibility with
    older callers.
    """
    raw = "|".join([
        _normalize_whitespace(company),
        _normalize_whitespace(title),
        _normalize_whitespace(location),
    ])
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_date(raw: str | None) -> datetime | None:
    """Best-effort parse of a date string into a UTC datetime."""
    if not raw:
        return None
    raw = raw.strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%a, %d %b %Y %H:%M:%S %z",   # RSS pubDate
        "%a, %d %b %Y %H:%M:%S %Z",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt
        except ValueError:
            continue
    return None


def insert_if_new(session: Session, job: Job) -> bool:
    """Insert a job or merge richer data into an existing record.

    Returns True if a brand-new job was inserted.
    If the job already exists, fields that are empty/missing on the
    existing record but present on the incoming one are back-filled,
    and the URL is upgraded to a direct link when possible.
    """
    existing = session.get(Job, job.id)
    if not existing:
        session.add(job)
        return True

    # Merge: fill in blanks on the existing record
    if not existing.jd_text and job.jd_text:
        existing.jd_text = job.jd_text
    elif job.jd_text and len(job.jd_text) > len(existing.jd_text or ""):
        # Keep the longer (richer) description
        existing.jd_text = job.jd_text

    if not existing.url and job.url:
        existing.url = job.url
    elif job.url and existing.url:
        # Prefer direct company URLs over aggregator redirects
        if _is_better_url(job.url, existing.url):
            existing.url = job.url

    if not existing.location and job.location:
        existing.location = job.location

    if not existing.posted_at and job.posted_at:
        existing.posted_at = job.posted_at
    if not existing.deadline and job.deadline:
        existing.deadline = job.deadline

    return False


_AGGREGATOR_DOMAINS = (
    "indeed.com", "glassdoor.com", "ziprecruiter.com", "remoteok.com",
    "arbeitnow.com", "linkedin.com", "stackoverflow.com", "angel.co",
    "wellfound.com", "simplyhired.com",
)


def _is_better_url(new_url: str, old_url: str) -> bool:
    """Return True if new_url is a more direct link than old_url."""
    old_is_aggregator = any(d in old_url for d in _AGGREGATOR_DOMAINS)
    new_is_aggregator = any(d in new_url for d in _AGGREGATOR_DOMAINS)
    # Prefer direct (non-aggregator) links over aggregator redirects
    return old_is_aggregator and not new_is_aggregator
