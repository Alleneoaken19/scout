"""Centralized path resolution for Scout.

All modules should import paths from here instead of computing them
relative to __file__. This ensures paths work in dev (running from repo),
installed (pip install), and Docker environments.
"""

import os
from pathlib import Path


def _find_project_root() -> Path:
    """Determine the project root directory.

    Priority:
    1. SCOUT_HOME environment variable (explicit override)
    2. Walk up from this file to find pyproject.toml (dev / editable install)
    3. Current working directory (fallback for pip-installed usage)
    """
    if env_root := os.getenv("SCOUT_HOME"):
        return Path(env_root).resolve()

    current = Path(__file__).resolve().parent  # src/
    for parent in [current, current.parent, current.parent.parent]:
        if (parent / "pyproject.toml").exists():
            return parent

    return Path.cwd()


PROJECT_ROOT = _find_project_root()
DATA_DIR = PROJECT_ROOT / "data"
CONFIG_DIR = PROJECT_ROOT / "config"
RESUME_DIR = PROJECT_ROOT / "resume"
CREDENTIALS_DIR = CONFIG_DIR / "credentials"
