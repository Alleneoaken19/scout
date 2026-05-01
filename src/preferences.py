"""Pydantic preferences model -- reads from config/preferences.yaml."""

import yaml
from pydantic import BaseModel, Field, field_validator

from src.paths import CONFIG_DIR

CONFIG_PATH = CONFIG_DIR / "preferences.yaml"

VALID_EXPERIENCE_LEVELS = {"junior", "mid", "senior", "staff", "lead"}
VALID_REMOTE_PREFS = {"remote_only", "remote_first", "hybrid", "onsite", "any"}
VALID_EMPLOYMENT_TYPES = {"full-time", "part-time", "contract", "internship", "freelance"}


VALID_DOMAINS = {"technology", "medical", "hospitality", "education", "general"}


class Preferences(BaseModel):
    domain: str = Field(default="general")  # technology, medical, hospitality, education, general
    job_titles: list[str] = Field(default=[])
    locations: list[str] = Field(default=["Remote"])
    experience_levels: list[str] = Field(default=["mid", "senior"])
    salary_min: int = Field(default=0, ge=0)
    remote_preference: str = Field(default="any")
    employment_type: list[str] = Field(default=["full-time"])
    industries: list[str] = Field(default=[])
    company_blacklist: list[str] = Field(default=[])
    excluded_locations: list[str] = Field(default=[])
    keywords_required: list[str] = Field(default=[])
    keywords_excluded: list[str] = Field(default=["unpaid"])
    min_match_score: float = Field(default=0.65, ge=0.0, le=1.0)
    max_applications_per_day: int = Field(default=15, ge=1, le=100)
    apply_automatically: bool = Field(default=False)

    @field_validator("job_titles")
    @classmethod
    def job_titles_clean(cls, v):
        return [t.strip() for t in v if t.strip()]

    @field_validator("experience_levels")
    @classmethod
    def valid_experience_levels(cls, v):
        cleaned = []
        for level in v:
            level = level.strip().lower()
            if level in VALID_EXPERIENCE_LEVELS:
                cleaned.append(level)
        return cleaned if cleaned else ["mid", "senior"]

    @field_validator("remote_preference")
    @classmethod
    def valid_remote_preference(cls, v):
        v = v.strip().lower()
        if v not in VALID_REMOTE_PREFS:
            return "any"
        return v

    @field_validator("employment_type")
    @classmethod
    def valid_employment_type(cls, v):
        cleaned = []
        for t in v:
            t = t.strip().lower()
            if t in VALID_EMPLOYMENT_TYPES:
                cleaned.append(t)
        return cleaned if cleaned else ["full-time"]

    @field_validator("locations")
    @classmethod
    def clean_locations(cls, v):
        return [loc.strip() for loc in v if loc.strip()]

    @field_validator("excluded_locations")
    @classmethod
    def clean_excluded_locations(cls, v):
        return [loc.strip() for loc in v if loc.strip()]


def load_preferences() -> Preferences:
    """Load preferences from YAML file, falling back to defaults."""
    if CONFIG_PATH.exists():
        text = CONFIG_PATH.read_text()
        if text.strip():
            data = yaml.safe_load(text)
            if isinstance(data, dict):
                return Preferences(**data)
    return Preferences()


def save_preferences(prefs: Preferences) -> None:
    """Write preferences back to YAML file."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(yaml.dump(prefs.model_dump(), default_flow_style=False, sort_keys=False))
