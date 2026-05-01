"""Cheap local pre-filter — string matching against user preferences.

Called by every scraper before insert_if_new() to discard obviously
irrelevant jobs.  No AI calls, no network — pure string matching.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.location_match import first_matching_pattern
from src.preferences import Preferences

_STOP_WORDS = frozenset(
    {"a", "an", "the", "of", "in", "for", "at", "and", "or", "to", "with", "on", "is"}
)

# Generic seniority and role-type words that add noise to title matching.
# NOTE: "manager", "specialist", "director" are meaningful in non-tech domains
# (Hotel Manager, Cardiac Specialist) — intentionally NOT filtered.
_ROLE_STOP_WORDS = frozenset({
    "engineer", "engineers", "engineering",
    "developer", "developers", "development",
    "senior", "junior", "mid", "lead", "staff", "principal",
    "sr", "jr", "ii", "iii", "iv",
    "intern", "associate",
    "remote", "hybrid", "contract", "freelance",
    "level", "tier",
})

# Common title abbreviation mappings across domains.
# Used to expand abbreviations before matching so "RN" matches "Registered Nurse".
_TITLE_ABBREVIATIONS: dict[str, list[str]] = {
    # Medical
    "rn": ["registered nurse"],
    "lpn": ["licensed practical nurse"],
    "np": ["nurse practitioner"],
    "md": ["doctor", "physician"],
    "pa": ["physician assistant"],
    "cna": ["certified nursing assistant"],
    "emt": ["emergency medical technician"],
    "ot": ["occupational therapist"],
    "pt": ["physical therapist"],
    # Hospitality
    "gm": ["general manager"],
    "f&b": ["food and beverage", "food beverage"],
    "foh": ["front of house"],
    "boh": ["back of house"],
    # Education
    "k-12": ["kindergarten through 12th grade"],
    # General
    "vp": ["vice president"],
    "cfo": ["chief financial officer"],
    "cto": ["chief technology officer"],
    "hr": ["human resources"],
    "pm": ["project manager", "product manager"],
}


@dataclass(frozen=True)
class PreFilterResult:
    passed: bool
    reason: str


def _expand_abbreviations(text: str) -> str:
    """Expand known abbreviations in text for matching.

    E.g., 'RN - ICU' becomes 'registered nurse - icu'
    and 'Registered Nurse' becomes 'registered nurse rn'
    """
    result = text.lower()
    # Forward: abbreviation → full form
    for abbr, expansions in _TITLE_ABBREVIATIONS.items():
        if abbr in result.split():
            result = result + " " + expansions[0]
    # Reverse: full form → abbreviation
    for abbr, expansions in _TITLE_ABBREVIATIONS.items():
        for expansion in expansions:
            if expansion in result:
                result = result + " " + abbr
                break
    return result


def _tokenize(text: str) -> set[str]:
    """Split text into lowercase words, stripping stop words."""
    return {w for w in text.lower().split() if w not in _STOP_WORDS and len(w) > 1}


def _tokenize_title(text: str) -> set[str]:
    """Split a job title into domain-specific words, removing generic role words."""
    return {
        w for w in text.lower().split()
        if w not in _STOP_WORDS and w not in _ROLE_STOP_WORDS and len(w) > 1
    }


def prefilter_job(
    title: str,
    company: str,
    location: str,
    description: str,
    prefs: Preferences,
) -> PreFilterResult:
    """Return whether a job passes cheap local preference checks.

    Every check is skipped when the corresponding preference list is empty,
    so an unconfigured Preferences object lets everything through.
    """
    title_lower = title.lower()
    company_lower = company.lower()
    desc_lower = description.lower()
    combined_lower = title_lower + " " + desc_lower

    # 1. Excluded locations — match against the job's location.
    #    Long patterns (≥4 chars) use substring match; short ones use
    #    word boundaries so "uk" doesn't false-positive on "stockholm".
    if prefs.excluded_locations and location:
        hit = first_matching_pattern(location, prefs.excluded_locations)
        if hit:
            return PreFilterResult(False, f"excluded_location:{hit}")

    # 2. Company blacklist
    if prefs.company_blacklist:
        for bl in prefs.company_blacklist:
            if bl.lower() in company_lower:
                return PreFilterResult(False, f"blacklisted_company:{bl}")

    # 2. Excluded keywords in title
    if prefs.keywords_excluded:
        for kw in prefs.keywords_excluded:
            if kw.lower() in title_lower:
                return PreFilterResult(False, f"excluded_keyword_in_title:{kw}")

    # 3. Title relevance — match on domain-specific words only.
    #    Generic words like "engineer"/"developer" are ignored so that
    #    "HVAC Engineer" doesn't match "Android Engineer".
    if prefs.job_titles:
        title_words = _tokenize_title(title)
        # Expand abbreviations in the job title for matching
        title_expanded = _expand_abbreviations(title_lower)
        matched = False
        for pref_title in prefs.job_titles:
            pref_title_lower = pref_title.lower()
            pref_expanded = _expand_abbreviations(pref_title_lower)

            # 1. Phrase match — direct or after abbreviation expansion
            if (pref_title_lower in title_lower
                    or pref_title_lower in title_expanded
                    or pref_expanded in title_lower
                    or pref_expanded in title_expanded):
                matched = True
                break

            # 2. Word overlap matching
            pref_words = _tokenize_title(pref_title)
            if not pref_words:
                pref_words = _tokenize(pref_title)
            if title_words & pref_words:
                matched = True
                break

            # 3. Abbreviation-expanded word overlap
            expanded_title_words = _tokenize_title(title_expanded)
            expanded_pref_words = _tokenize_title(pref_expanded)
            if not expanded_pref_words:
                expanded_pref_words = _tokenize(pref_expanded)
            if expanded_title_words & expanded_pref_words:
                matched = True
                break

        if not matched:
            return PreFilterResult(False, "title_mismatch")

    # 4. Excluded keywords in description
    if prefs.keywords_excluded and desc_lower:
        for kw in prefs.keywords_excluded:
            if kw.lower() in desc_lower:
                return PreFilterResult(False, f"excluded_keyword_in_desc:{kw}")

    # 5. Required keywords (OR — at least one must appear in title+description)
    if prefs.keywords_required and combined_lower:
        if not any(kw.lower() in combined_lower for kw in prefs.keywords_required):
            return PreFilterResult(False, "no_required_keywords")

    return PreFilterResult(True, "passed")
