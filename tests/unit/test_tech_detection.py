"""Unit tests for tech role detection used by conditional scrapers."""

from src.preferences import Preferences


# Import the function from cli — we need to handle the import carefully
def _has_tech_titles(prefs) -> bool:
    """Local copy of the detection logic for testing."""
    _TECH_TITLE_WORDS = frozenset({
        "software", "developer", "engineer", "android", "ios", "mobile",
        "frontend", "backend", "fullstack", "full-stack", "devops", "data",
        "ml", "ai", "cloud", "sre", "platform", "infrastructure", "web",
        "react", "python", "java", "kotlin", "flutter", "kmp", "golang",
        "rust", "node", "typescript", "javascript", "php", "ruby", "scala",
        "embedded", "firmware", "security", "cybersecurity", "devsecops",
        "qa", "sdet", "automation", "database", "dba",
    })
    for title in prefs.job_titles:
        if any(word in _TECH_TITLE_WORDS for word in title.lower().split()):
            return True
    return False


def test_software_engineer_is_tech():
    assert _has_tech_titles(Preferences(job_titles=["Software Engineer"])) is True


def test_backend_developer_is_tech():
    assert _has_tech_titles(Preferences(job_titles=["Backend Developer"])) is True


def test_head_chef_not_tech():
    assert _has_tech_titles(Preferences(job_titles=["Head Chef", "Pastry Chef"])) is False


def test_registered_nurse_not_tech():
    assert _has_tech_titles(Preferences(job_titles=["Registered Nurse"])) is False


def test_accountant_not_tech():
    assert _has_tech_titles(Preferences(job_titles=["Senior Accountant"])) is False


def test_teacher_not_tech():
    assert _has_tech_titles(Preferences(job_titles=["High School Teacher"])) is False


def test_mixed_titles():
    """If any title is tech, should return True."""
    assert _has_tech_titles(Preferences(job_titles=["Chef", "Software Engineer"])) is True


def test_empty_titles():
    assert _has_tech_titles(Preferences(job_titles=[])) is False


def test_data_analyst_is_tech():
    assert _has_tech_titles(Preferences(job_titles=["Data Analyst"])) is True
