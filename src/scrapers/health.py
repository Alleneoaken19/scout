"""Scraper health tracking — monitors consecutive zero-result runs."""

import json
from datetime import UTC, datetime

from src.paths import DATA_DIR

HEALTH_PATH = DATA_DIR / "scraper_health.json"
ALERT_THRESHOLD = 3  # Alert after N consecutive zero-result runs


def _load_health() -> dict:
    if HEALTH_PATH.exists():
        try:
            return json.loads(HEALTH_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_health(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HEALTH_PATH.write_text(json.dumps(data, indent=2))


def record_scrape_result(source: str, new_count: int, error: str | None = None) -> list[str]:
    """Record a scraper run result. Returns list of warning messages if any."""
    health = _load_health()

    if source not in health:
        health[source] = {"consecutive_zeros": 0, "last_success": None, "last_error": None}

    entry = health[source]
    entry["last_run"] = datetime.now(UTC).isoformat()

    warnings = []

    if error:
        entry["last_error"] = error
        entry["consecutive_zeros"] = entry.get("consecutive_zeros", 0) + 1
    elif new_count == 0:
        entry["consecutive_zeros"] = entry.get("consecutive_zeros", 0) + 1
    else:
        entry["consecutive_zeros"] = 0
        entry["last_success"] = datetime.now(UTC).isoformat()
        entry["last_error"] = None

    if entry["consecutive_zeros"] >= ALERT_THRESHOLD:
        warnings.append(
            f"Scraper '{source}' has returned 0 results for "
            f"{entry['consecutive_zeros']} consecutive runs. "
            f"It may be broken or rate-limited."
        )

    _save_health(health)
    return warnings


def get_health_summary() -> dict:
    """Return scraper health data for monitoring."""
    return _load_health()
