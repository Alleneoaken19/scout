"""Unit tests for the prefilter module."""

from src.preferences import Preferences
from src.scrapers.prefilter import prefilter_job


def test_nurse_job_passes_for_nurse_preferences():
    """Non-tech job should pass when user is looking for that role."""
    prefs = Preferences(job_titles=["Registered Nurse"], keywords_required=["nurse"])
    result = prefilter_job("Registered Nurse - ICU", "Hospital", "New York", "Seeking nurse for ICU ward...", prefs)
    assert result.passed, f"Nurse job should pass, got: {result.reason}"


def test_chef_job_passes_for_chef_preferences():
    prefs = Preferences(job_titles=["Head Chef"], keywords_required=["chef"])
    result = prefilter_job("Head Chef", "Restaurant", "London", "Looking for an experienced chef...", prefs)
    assert result.passed


def test_empty_job_titles_passes_all():
    prefs = Preferences(job_titles=[])
    result = prefilter_job("Anything Goes", "Company", "Anywhere", "Any description", prefs)
    assert result.passed


def test_excluded_keyword_in_title():
    prefs = Preferences(job_titles=["Engineer"], keywords_excluded=["unpaid"])
    result = prefilter_job("Unpaid Engineering Intern", "Startup", "Remote", "Great opportunity", prefs)
    assert not result.passed
    assert "excluded_keyword_in_title" in result.reason


def test_excluded_keyword_case_insensitive():
    prefs = Preferences(job_titles=["Engineer"], keywords_excluded=["sales"])
    result = prefilter_job("Sales Engineer", "Corp", "NYC", "Sell stuff", prefs)
    assert not result.passed


def test_blacklisted_company():
    prefs = Preferences(job_titles=["Developer"], company_blacklist=["BadCorp"])
    result = prefilter_job("Developer", "BadCorp Inc", "Remote", "Job desc", prefs)
    assert not result.passed
    assert "blacklisted_company" in result.reason


def test_required_keywords_or_logic():
    prefs = Preferences(job_titles=["Engineer"], keywords_required=["Python", "Rust"])
    result = prefilter_job("Engineer", "Company", "Remote", "We use Python extensively", prefs)
    assert result.passed  # At least one required keyword present


def test_required_keywords_none_present():
    prefs = Preferences(job_titles=["Engineer"], keywords_required=["Haskell"])
    result = prefilter_job("Engineer", "Company", "Remote", "We use Python and Java", prefs)
    assert not result.passed
    assert "no_required_keywords" in result.reason


def test_title_mismatch():
    prefs = Preferences(job_titles=["Android Developer"])
    result = prefilter_job("Marketing Manager", "Company", "Remote", "Marketing role", prefs)
    assert not result.passed
    assert "title_mismatch" in result.reason


def test_phrase_match_in_title():
    """Multi-word job titles should match as phrases."""
    prefs = Preferences(job_titles=["Machine Learning"])
    result = prefilter_job("Senior Machine Learning Engineer", "Company", "Remote", "ML role", prefs)
    assert result.passed


def test_contradictory_preferences_filters_everything():
    """keywords_required and keywords_excluded overlap — everything filtered."""
    prefs = Preferences(
        job_titles=["Developer"],
        keywords_required=["Python"],
        keywords_excluded=["Python"],
    )
    result = prefilter_job("Python Developer", "Corp", "Remote", "Python role", prefs)
    assert not result.passed
