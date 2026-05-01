"""Centralized logging configuration with PII/credential redaction."""

import logging
import re
import sys

from src.paths import DATA_DIR


# Patterns that should be redacted from all log output
_REDACT_PATTERNS = [
    (re.compile(r'sk-ant-[a-zA-Z0-9_-]+'), 'sk-ant-***REDACTED***'),
    (re.compile(r'AIza[a-zA-Z0-9_-]{35}'), '***GEMINI_KEY_REDACTED***'),
    (re.compile(r'ntn_[a-zA-Z0-9]+'), 'ntn_***REDACTED***'),
    (re.compile(r'secret_[a-zA-Z0-9]+'), 'secret_***REDACTED***'),
    # Redact email addresses in log messages
    (re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'), '***EMAIL***'),
    # Redact phone numbers (basic patterns)
    (re.compile(r'\+?\d[\d\s\-]{8,}\d'), '***PHONE***'),
]


class RedactingFilter(logging.Filter):
    """Log filter that redacts sensitive information."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern, replacement in _REDACT_PATTERNS:
                record.msg = pattern.sub(replacement, record.msg)
        if record.args:
            new_args = []
            for arg in (record.args if isinstance(record.args, tuple) else (record.args,)):
                if isinstance(arg, str):
                    for pattern, replacement in _REDACT_PATTERNS:
                        arg = pattern.sub(replacement, arg)
                new_args.append(arg)
            record.args = tuple(new_args) if isinstance(record.args, tuple) else new_args[0]
        return True


def setup_logging(level: int = logging.INFO) -> None:
    """Configure logging for the Scout application."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log_path = DATA_DIR / "scout.log"

    # Create formatters
    file_fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    console_fmt = logging.Formatter("%(levelname)s: %(message)s")

    # Root logger
    root = logging.getLogger("scout")
    root.setLevel(level)

    # Redacting filter on all handlers
    redact_filter = RedactingFilter()

    # File handler
    file_handler = logging.FileHandler(str(log_path), encoding="utf-8")
    file_handler.setLevel(level)
    file_handler.setFormatter(file_fmt)
    file_handler.addFilter(redact_filter)
    root.addHandler(file_handler)

    # Console handler (only warnings and above to avoid cluttering Rich output)
    console_handler = logging.StreamHandler(sys.stderr)
    console_handler.setLevel(logging.WARNING)
    console_handler.setFormatter(console_fmt)
    console_handler.addFilter(redact_filter)
    root.addHandler(console_handler)


def get_logger(name: str) -> logging.Logger:
    """Get a logger for a specific module."""
    return logging.getLogger(f"scout.{name}")
