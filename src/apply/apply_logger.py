"""Apply logger -- logs every apply action to data/apply_log.jsonl."""

import fcntl
import json
from datetime import UTC, datetime

from src.paths import DATA_DIR

LOG_PATH = DATA_DIR / "apply_log.jsonl"


def log_action(
    job_id: str,
    portal: str,
    action: str,
    details: dict | None = None,
    dry_run: bool = False,
) -> None:
    """Append a log entry to apply_log.jsonl (thread-safe with file locking)."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "job_id": job_id,
        "portal": portal,
        "action": action,
        "dry_run": dry_run,
        "details": details or {},
    }

    line = json.dumps(entry) + "\n"

    with open(LOG_PATH, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.write(line)
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
