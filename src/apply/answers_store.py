"""Answers library — load/save form answers per portal. Notify on unknown questions."""

import json
from pathlib import Path

from rich.console import Console

from src.paths import CONFIG_DIR

ANSWERS_DIR = CONFIG_DIR / "answers"

console = Console()


def _answers_path(portal: str) -> Path:
    return ANSWERS_DIR / f"{portal}.json"


def load_answers(portal: str) -> dict[str, str]:
    """Load saved answers for a portal (greenhouse, lever, workday, general)."""
    path = _answers_path(portal)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, TypeError):
            console.print(f"  [yellow]Warning: corrupted answers file {path.name}, using empty[/yellow]")
            return {}
    return {}


def save_answers(portal: str, answers: dict[str, str]) -> None:
    """Save answers back to the portal JSON file."""
    ANSWERS_DIR.mkdir(parents=True, exist_ok=True)
    path = _answers_path(portal)
    path.write_text(json.dumps(answers, indent=2))


def get_answer(portal: str, question: str) -> str | None:
    """Look up an answer by question text. Checks portal-specific, then general."""
    # Normalize question for lookup
    key = _normalize_question(question)

    # Check portal-specific answers
    portal_answers = load_answers(portal)
    if key in portal_answers:
        return portal_answers[key]

    # Check general answers
    general = load_answers("general")
    if key in general:
        return general[key]

    # Try fuzzy matching -- check if saved key appears in the question or vice versa
    # Use the raw question text (not normalized) for better matching
    question_lower = question.lower().strip()

    best_match = None
    best_score = 0

    for answers in [portal_answers, general]:
        for saved_key, saved_val in answers.items():
            saved_lower = saved_key.lower()

            # Exact substring in either direction
            if saved_lower in question_lower or question_lower in saved_lower:
                # Score by length of match relative to question length
                match_len = min(len(saved_lower), len(question_lower))
                score = match_len / max(len(saved_lower), len(question_lower))

                # Require high overlap (>= 70%) and meaningful key length (>= 6 chars)
                # to avoid "name" matching "first name" or "phone" matching "phone number"
                if score > best_score and score >= 0.7 and match_len >= 6:
                    best_score = score
                    best_match = saved_val

    return best_match


def record_unknown_question(portal: str, question: str) -> None:
    """Record an unknown question and send a macOS notification."""
    console.print(f"  [yellow]Unknown question:[/yellow] {question}")
    console.print(f"  [dim]Add answer to config/answers/{portal}.json or general.json[/dim]")

    try:
        from plyer import notification
        notification.notify(
            title="Scout — Unknown Question",
            message=f"[{portal}] {question[:100]}",
            timeout=10,
        )
    except Exception:
        pass  # Notification is best-effort


def _normalize_question(question: str) -> str:
    """Normalize a question string to a lookup key."""
    return question.strip().lower().replace(" ", "_").replace("?", "").replace("*", "")[:80]
