"""Shared helper for matching location patterns against a job's location string.

Used by both the scrape-time prefilter and the cleanup endpoint, so they
behave identically.

Matching rules:
- Patterns of 4+ characters use case-insensitive substring match.
  ("india" matches "Bengaluru, Karnataka, India")
- Short patterns (≤3 chars) use case-insensitive **word-boundary** match
  so that country codes like "uk" don't false-positive on "Berlin" or
  "Stockholm".
"""

from __future__ import annotations

import re
from functools import lru_cache


@lru_cache(maxsize=512)
def _compile_short_pattern(pattern: str) -> re.Pattern:
    # Use \b word boundaries; escape user input
    return re.compile(rf"\b{re.escape(pattern.lower())}\b", re.IGNORECASE)


def matches_location(location: str | None, pattern: str) -> bool:
    """Return True if `pattern` matches the `location` per the matching rules."""
    if not location or not pattern:
        return False
    p = pattern.strip().lower()
    if not p:
        return False
    loc = location.lower()
    if len(p) <= 3:
        return bool(_compile_short_pattern(p).search(loc))
    return p in loc


def first_matching_pattern(location: str | None, patterns: list[str]) -> str | None:
    """Return the first pattern that matches, or None."""
    if not location:
        return None
    for p in patterns:
        if matches_location(location, p):
            return p
    return None
