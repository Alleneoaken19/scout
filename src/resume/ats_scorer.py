"""ATS scorer — keyword-aware, weighted resume↔JD matching.

Why this isn't naive token overlap:
A typical JD has 500-800 words, of which only ~80 are real hard
requirements. The other 600+ are filler ("equal opportunity", "competitive
benefits", "fast-paced", "passionate about our mission") that no resume
should echo. Naive `len(jd_words ∩ resume_words) / len(jd_words)` therefore
caps a perfectly tailored resume at ~30-50%, which is exactly what users
were observing.

The new approach mirrors what production tools (Jobscan, Workday, Taleo)
actually do: score against a curated keyword list, weighted by required vs
preferred. We use the AI-extracted `ats_keywords` from src/ai/scorer.py
when available — they're already on the Job row, free, and skill-focused.
"""

import json
import re
from pathlib import Path

from src.paths import DATA_DIR

ALIASES_PATH = DATA_DIR.parent / "data" / "tech_aliases.json"
DOMAIN_ALIASES_DIR = DATA_DIR.parent / "data" / "domain_aliases"
# In production install the data dir lives next to src; in dev it's the repo root.
# Try a couple of fallbacks.
_ALIAS_FALLBACKS = [
    Path(__file__).parent.parent.parent / "data" / "tech_aliases.json",
]
_DOMAIN_ALIAS_FALLBACKS = [
    Path(__file__).parent.parent.parent / "data" / "domain_aliases",
]


# ---------------------------------------------------------------------------
# Hardcoded compounds (kept for backward compat; aliases.json is authoritative)
# ---------------------------------------------------------------------------

_TECH_COMPOUNDS = {
    "c++": "cpp",
    "c#": "csharp",
    "node.js": "nodejs",
    ".net": "dotnet",
    "react.js": "reactjs",
    "vue.js": "vuejs",
    "next.js": "nextjs",
    "ci/cd": "ci-cd",
    "docker compose": "docker-compose",
    "jetpack compose": "jetpack-compose",
    "kotlin multiplatform": "kotlin-multiplatform",
    "machine learning": "machine-learning",
    "deep learning": "deep-learning",
    "rest api": "rest-api",
    "react native": "react-native",
}

_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "this", "that", "these",
    "those", "it", "its", "we", "you", "they", "our", "your", "their",
    "not", "no", "as", "if", "than", "so", "about", "up", "out", "all",
    "also", "into", "more", "other", "some", "such", "who", "which",
    "what", "when", "where", "how", "each", "every", "any",
}


# ---------------------------------------------------------------------------
# Alias loading
# ---------------------------------------------------------------------------

def _load_alias_map() -> dict[str, str]:
    """Return {alias_lower: canonical_lower}. Loads tech aliases + all domain alias files."""
    aliases: dict[str, str] = {}

    # Hardcoded compounds first
    for alias, canonical in _TECH_COMPOUNDS.items():
        aliases[alias.lower().strip()] = canonical.lower().strip()

    # Collect all alias files to load: tech_aliases.json + all domain_aliases/*.json
    alias_files: list[Path] = []

    # Tech aliases (primary)
    for path in [ALIASES_PATH, *_ALIAS_FALLBACKS]:
        if path.exists():
            alias_files.append(path)
            break

    # Domain aliases (all files in domain_aliases/)
    for aliases_dir in [DOMAIN_ALIASES_DIR, *_DOMAIN_ALIAS_FALLBACKS]:
        if aliases_dir.is_dir():
            alias_files.extend(sorted(aliases_dir.glob("*.json")))
            break

    # Load all alias files
    for path in alias_files:
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        for canonical, alts in data.items():
            if canonical.startswith("_"):  # comments / metadata
                continue
            canonical_lower = canonical.lower().strip()
            aliases[canonical_lower] = canonical_lower  # identity
            if isinstance(alts, list):
                for alt in alts:
                    if not isinstance(alt, str):
                        continue
                    alt_lower = alt.lower().strip()
                    if alt_lower:
                        aliases[alt_lower] = canonical_lower

    return aliases


# Cache the loaded alias map (cleared on domain change)
_cached_alias_map: dict[str, str] | None = None


def _get_alias_map() -> dict[str, str]:
    """Get the cached alias map, loading if needed."""
    global _cached_alias_map
    if _cached_alias_map is None:
        _cached_alias_map = _load_alias_map()
    return _cached_alias_map


def canonicalize_text(text: str) -> str:
    """Lowercase + replace any known aliases with their canonical form.

    Sorted by length desc so multi-word phrases match before their parts.
    """
    if not text:
        return ""
    out = text.lower()
    aliases = _get_alias_map()
    # Only do replacements for non-identity entries (saves work)
    for alias in sorted((a for a in aliases if a != aliases[a]), key=len, reverse=True):
        canonical = aliases[alias]
        # Word-boundary aware replacement; \b doesn't work at edges of "+", "#"
        # so use a custom boundary that allows non-alnum.
        pattern = rf'(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])'
        out = re.sub(pattern, canonical, out)
    return out


def canonicalize_keyword(keyword: str) -> str:
    """Normalize a single keyword to its canonical form."""
    aliases = _get_alias_map()
    kw = keyword.lower().strip()
    return aliases.get(kw, kw)


# ---------------------------------------------------------------------------
# Backward-compat tokenization (still used by gap_analysis for word sets)
# ---------------------------------------------------------------------------

def extract_words(text: str) -> set[str]:
    """Extract meaningful words/tokens from text. Lowercased + canonicalized.

    Kept for backward compatibility with gap_analysis. Returns a set of
    1-token strings (post-alias-normalization).
    """
    canonical = canonicalize_text(text)
    words = set(re.findall(r"[a-z0-9#+.-]+", canonical))
    return {w for w in words if (len(w) > 1 or w in ("c", "r"))} - _STOP_WORDS


def extract_resume_text(tailored: dict) -> str:
    """Concatenate every textual field of a tailored resume dict."""
    parts: list[str] = [tailored.get("summary", "")]
    for exp in tailored.get("experience", []):
        parts.append(exp.get("role", ""))
        for bullet in exp.get("bullets", []):
            parts.append(bullet if isinstance(bullet, str) else bullet.get("text", ""))
    skills = tailored.get("skills", {})
    if isinstance(skills, dict):
        for items in skills.values():
            if isinstance(items, list):
                parts.extend(items)
    elif isinstance(skills, list):
        parts.extend(skills)
    for proj in tailored.get("projects", []):
        if isinstance(proj, dict):
            parts.append(proj.get("name", ""))
            parts.append(proj.get("description", ""))
    return " ".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Keyword classification (required vs preferred)
# ---------------------------------------------------------------------------

_REQUIRED_MARKERS = re.compile(
    r"\b(require[ds]?|requirements?|must\s+have|must|qualifications?|"
    r"essentials?|need(?:ed)?|mandatory)\b",
    re.IGNORECASE,
)


def _keyword_in_text(keyword: str, text: str) -> bool:
    """Word-boundary aware containment check on already-canonicalized text."""
    if not keyword or not text:
        return False
    pattern = rf'(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])'
    return bool(re.search(pattern, text))


def _classify_keywords(
    keywords: list[str], canonical_jd: str
) -> tuple[list[str], list[str]]:
    """Split keywords into (required, preferred).

    Required if either:
      - appears ≥2 times in the JD, OR
      - a mention sits within ~200 chars of a "required/must/qualification" marker
    Otherwise preferred.
    """
    required: list[str] = []
    preferred: list[str] = []

    marker_positions = [m.start() for m in _REQUIRED_MARKERS.finditer(canonical_jd)]

    for kw in keywords:
        if not kw:
            continue
        # All keyword occurrences in the JD
        occ_positions = [
            m.start()
            for m in re.finditer(
                rf'(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])', canonical_jd
            )
        ]
        if not occ_positions:
            # Not in JD at all but was passed in — treat as preferred
            preferred.append(kw)
            continue
        if len(occ_positions) >= 2:
            required.append(kw)
            continue
        near_marker = any(
            abs(kp - mp) < 200
            for kp in occ_positions
            for mp in marker_positions
        )
        if near_marker:
            required.append(kw)
        else:
            preferred.append(kw)

    return required, preferred


# ---------------------------------------------------------------------------
# Fallback keyword extraction (only used when no AI keywords available)
# ---------------------------------------------------------------------------

# Very broad stopword filter for fallback extraction
_FALLBACK_NOISE = _STOP_WORDS | {
    "we", "you", "they", "us", "our", "your", "their", "i", "me", "my",
    "experience", "team", "work", "working", "role", "position", "job",
    "company", "candidate", "candidates", "must", "required", "prefer",
    "preferred", "responsibilities", "qualifications", "skills", "ability",
    "able", "looking", "seeking", "join", "help", "build", "create",
    "make", "use", "using", "well", "good", "great", "best", "strong",
    "passionate", "excellent", "fast", "paced", "remote", "onsite",
    "hybrid", "office", "salary", "benefits", "equity", "stock", "options",
    "paid", "unpaid", "leave", "vacation", "pto", "401k", "insurance",
    "health", "dental", "vision", "wellness", "competitive", "diverse",
    "inclusive", "equal", "opportunity", "employer", "minimum", "plus",
    "years", "year", "month", "months", "day", "days", "yrs",
    "across", "via", "within", "while", "during", "before", "after",
    "etc", "ie", "eg", "approximately", "about", "between", "among",
    "however", "therefore", "thus", "hence", "though", "although",
}


# Short keywords that are meaningful across domains — never filter these out
_SHORT_KEYWORD_WHITELIST = {
    # Medical
    "rn", "md", "do", "lpn", "np", "pa", "icu", "er", "or", "ed", "ot", "pt",
    "rrt", "cna", "bls", "cpr", "emr", "ehr",
    # Education
    "ap", "ib", "esl", "efl", "iep", "lms", "k-12",
    # Hospitality
    "fb", "pos", "gm",
    # Tech (already handled by aliases but keep for fallback)
    "ai", "ml", "qa", "ci", "cd", "ui", "ux", "db", "js", "ts", "go",
    # General
    "hr", "pm", "vp", "cfo", "cto", "ceo", "coo",
}


def _fallback_keywords(canonical_jd: str, top_n: int = 30) -> list[str]:
    """Extract candidate keywords from JD when no AI list is available.

    Strategy: count 1-grams that look like domain terms (alpha + maybe digits),
    drop noise, return the top N most frequent. Short terms (< 3 chars) are
    kept if they appear in the cross-domain whitelist.
    """
    tokens = re.findall(r"[a-z][a-z0-9+#.-]{1,}", canonical_jd)
    from collections import Counter
    counts: Counter[str] = Counter()
    for t in tokens:
        if t in _FALLBACK_NOISE:
            continue
        if len(t) < 3 and t not in _SHORT_KEYWORD_WHITELIST:
            continue
        counts[t] += 1
    return [w for w, _ in counts.most_common(top_n)]


# ---------------------------------------------------------------------------
# Main scorer
# ---------------------------------------------------------------------------

# Tunable weights
REQUIRED_WEIGHT = 1.0
PREFERRED_WEIGHT = 0.5
SKILLS_WEIGHT = 0.85          # contribution of weighted-keyword match to overall
COVERAGE_WEIGHT = 0.15        # contribution of broader text overlap (informational)
COVERAGE_BOOST = 1.5          # multiplier inside coverage so it's not punitively low
OVERALL_CAP = 0.98            # discourage 100% (= keyword stuffing)


def score_resume(
    resume_text: str,
    jd_text: str,
    keywords: list[str] | None = None,
) -> dict:
    """Score a resume against a JD using a weighted keyword model.

    Args:
        resume_text: Full resume text (use extract_resume_text() on a tailored
            resume dict).
        jd_text: Job description text.
        keywords: Authoritative skill list, e.g. job.ats_keywords from the AI
            scorer. If None, falls back to noise-filtered frequency extraction.

    Returns:
        {
            "overall": 0.82,
            "skills_match": 0.85,
            "keyword_coverage": 0.45,
            "matched_required": [...],
            "missing_required": [...],
            "matched_preferred": [...],
            "missing_preferred": [...],
            "stats": {
                "required_count": 12,
                "matched_required_count": 10,
                "preferred_count": 8,
                "matched_preferred_count": 5,
                "used_ai_keywords": True,
            },
        }
    """
    canonical_resume = canonicalize_text(resume_text)
    canonical_jd = canonicalize_text(jd_text)

    used_ai_keywords = bool(keywords)
    if keywords:
        # Deduplicate canonical forms while preserving first display of each
        seen: set[str] = set()
        canonical_keywords: list[str] = []
        for raw in keywords:
            if not isinstance(raw, str):
                continue
            c = canonicalize_keyword(raw)
            if c and c not in seen:
                seen.add(c)
                canonical_keywords.append(c)
    else:
        canonical_keywords = _fallback_keywords(canonical_jd)

    if not canonical_keywords:
        return _empty_result(used_ai_keywords)

    required, preferred = _classify_keywords(canonical_keywords, canonical_jd)

    matched_required = [k for k in required if _keyword_in_text(k, canonical_resume)]
    missing_required = [k for k in required if k not in matched_required]
    matched_preferred = [k for k in preferred if _keyword_in_text(k, canonical_resume)]
    missing_preferred = [k for k in preferred if k not in matched_preferred]

    weighted_hits = (
        REQUIRED_WEIGHT * len(matched_required)
        + PREFERRED_WEIGHT * len(matched_preferred)
    )
    weighted_total = (
        REQUIRED_WEIGHT * len(required)
        + PREFERRED_WEIGHT * len(preferred)
    )
    skills_match = weighted_hits / weighted_total if weighted_total > 0 else 0.0

    # Broader keyword coverage on the full JD (sanity / informational signal)
    jd_words = extract_words(canonical_jd)
    resume_words = extract_words(canonical_resume)
    keyword_coverage = (
        len(jd_words & resume_words) / len(jd_words) if jd_words else 0.0
    )

    overall = (
        SKILLS_WEIGHT * skills_match
        + COVERAGE_WEIGHT * min(keyword_coverage * COVERAGE_BOOST, 1.0)
    )
    overall = min(overall, OVERALL_CAP)

    return {
        "overall": round(overall, 3),
        "skills_match": round(skills_match, 3),
        "keyword_coverage": round(keyword_coverage, 3),
        "matched_required": matched_required,
        "missing_required": missing_required,
        "matched_preferred": matched_preferred,
        "missing_preferred": missing_preferred,
        "stats": {
            "required_count": len(required),
            "matched_required_count": len(matched_required),
            "preferred_count": len(preferred),
            "matched_preferred_count": len(matched_preferred),
            "used_ai_keywords": used_ai_keywords,
        },
    }


def _empty_result(used_ai_keywords: bool) -> dict:
    return {
        "overall": 0.0,
        "skills_match": 0.0,
        "keyword_coverage": 0.0,
        "matched_required": [],
        "missing_required": [],
        "matched_preferred": [],
        "missing_preferred": [],
        "stats": {
            "required_count": 0,
            "matched_required_count": 0,
            "preferred_count": 0,
            "matched_preferred_count": 0,
            "used_ai_keywords": used_ai_keywords,
        },
    }


# ---------------------------------------------------------------------------
# Backward-compat shim for older callers
# ---------------------------------------------------------------------------

def ats_score(
    resume_text: str,
    jd_text: str,
    keywords: list[str] | None = None,
) -> float:
    """Backward-compat: returns just the overall score as a float 0.0-1.0.

    Prefer score_resume() for new code — it returns the breakdown.
    """
    return score_resume(resume_text, jd_text, keywords)["overall"]
