"""Market gap analysis — find skills the job market demands that your resume lacks."""

import json
from collections import Counter

from src.database import Job, managed_session
from src.resume.ats_scorer import extract_resume_text, extract_words


def market_gap_report(master_resume: dict, min_jobs: int = 2) -> dict:
    """Analyze all scored jobs to find skills gaps in the master resume.

    Returns:
        {
            "resume_keywords": [...],       # what your resume has
            "market_keywords": [            # sorted by frequency desc
                {"keyword": "kubernetes", "job_count": 45, "pct": 0.72, "in_resume": false},
                ...
            ],
            "missing_high_demand": [...],   # missing from resume, in 30%+ of jobs
            "present_high_demand": [...],   # in resume AND in 30%+ of jobs
            "total_jobs_analyzed": 62,
        }
    """
    # Extract resume keywords
    resume_text = extract_resume_text(master_resume)
    resume_words = extract_words(resume_text)

    # Also include raw skills list for better matching
    skills = master_resume.get("skills", [])
    if isinstance(skills, dict):
        for items in skills.values():
            for s in items:
                resume_words.update(extract_words(s))
    elif isinstance(skills, list):
        for s in skills:
            resume_words.update(extract_words(s))

    # Collect ATS keywords from all scored jobs
    keyword_counter: Counter = Counter()
    total_jobs = 0

    with managed_session() as session:
        jobs = (
            session.query(Job)
            .filter(Job.ats_keywords.isnot(None))
            .filter(Job.match_score.isnot(None))
            .all()
        )

        for job in jobs:
            try:
                keywords = json.loads(job.ats_keywords)
                if not isinstance(keywords, list):
                    continue
            except (json.JSONDecodeError, TypeError):
                continue

            total_jobs += 1
            # Normalize each keyword and count
            seen_in_job: set[str] = set()
            for kw in keywords:
                normalized = kw.strip().lower()
                if normalized and normalized not in seen_in_job:
                    seen_in_job.add(normalized)
                    keyword_counter[normalized] += 1

    if total_jobs == 0:
        return {
            "resume_keywords": sorted(resume_words),
            "market_keywords": [],
            "missing_high_demand": [],
            "present_high_demand": [],
            "total_jobs_analyzed": 0,
        }

    # Build market keywords with resume match status
    market_keywords = []
    for kw, count in keyword_counter.most_common():
        if count < min_jobs:
            continue
        kw_words = extract_words(kw)
        in_resume = bool(kw_words & resume_words)
        market_keywords.append({
            "keyword": kw,
            "job_count": count,
            "pct": round(count / total_jobs, 2),
            "in_resume": in_resume,
        })

    missing = [m for m in market_keywords if not m["in_resume"]]
    present = [m for m in market_keywords if m["in_resume"]]

    return {
        "resume_keywords": sorted(resume_words)[:100],
        "market_keywords": market_keywords[:100],
        "missing_high_demand": missing[:50],
        "present_high_demand": present[:50],
        "total_jobs_analyzed": total_jobs,
    }


def job_gap_report(master_resume: dict, job: Job) -> dict:
    """Per-job gap analysis using the keyword-aware scorer.

    Returns the new score_resume() breakdown plus legacy keys
    (ats_score, matching, missing, ai_keywords_missing, …) so existing
    UI / API consumers keep working.
    """
    from src.resume.ats_scorer import score_resume

    resume_text = extract_resume_text(master_resume)
    # Also include raw skills text so the scorer can see them
    skills = master_resume.get("skills", [])
    skills_text_parts: list[str] = []
    if isinstance(skills, dict):
        for items in skills.values():
            if isinstance(items, list):
                skills_text_parts.extend(items)
    elif isinstance(skills, list):
        skills_text_parts.extend(skills)
    if skills_text_parts:
        resume_text = resume_text + "\n" + " ".join(skills_text_parts)

    jd_text = job.jd_text or ""

    # Authoritative keyword list from the AI scorer (if available)
    ai_keywords: list[str] = []
    if job.ats_keywords:
        try:
            parsed = json.loads(job.ats_keywords)
            if isinstance(parsed, list):
                ai_keywords = [k for k in parsed if isinstance(k, str)]
        except (json.JSONDecodeError, TypeError):
            pass

    breakdown = score_resume(resume_text, jd_text, keywords=ai_keywords or None)

    matched_all = breakdown["matched_required"] + breakdown["matched_preferred"]
    missing_all = breakdown["missing_required"] + breakdown["missing_preferred"]

    return {
        # New / canonical fields
        "overall": breakdown["overall"],
        "skills_match": breakdown["skills_match"],
        "keyword_coverage": breakdown["keyword_coverage"],
        "matched_required": breakdown["matched_required"],
        "missing_required": breakdown["missing_required"],
        "matched_preferred": breakdown["matched_preferred"],
        "missing_preferred": breakdown["missing_preferred"],
        "stats": breakdown["stats"],

        # Legacy fields (for unchanged UI consumers)
        "ats_score": breakdown["overall"],
        "matching": matched_all[:50],
        "matching_count": len(matched_all),
        "missing": missing_all[:50],
        "missing_count": len(missing_all),
        "jd_keywords_count": len(matched_all) + len(missing_all),
        "ai_keywords": ai_keywords,
        "ai_keywords_missing": breakdown["missing_required"],
    }
