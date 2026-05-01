"""Golden-set tests for the ATS scorer.

These pin the expected score ranges so we don't silently regress when
tweaking the algorithm. If a test fails after a deliberate change,
update the bounds — don't widen them just to make CI green.
"""

import pytest

from src.resume.ats_scorer import (
    canonicalize_keyword,
    canonicalize_text,
    extract_resume_text,
    score_resume,
)


# ---------------------------------------------------------------------------
# Fixtures: realistic JD with filler + tailored / master / off-target resumes
# ---------------------------------------------------------------------------

JD_BACKEND = """\
About us:
We are a fast-paced, mission-driven, equal-opportunity employer offering
competitive salary, dental, 401k, flexible PTO, and wellness benefits.
We love passionate collaborators who thrive in ambiguity.

Required:
- 5+ years building Python services, ideally with Django
- Strong PostgreSQL and Redis experience
- Production AWS experience (EC2, S3, Lambda)
- Comfortable with Docker, Kubernetes (k8s), and CI/CD pipelines
- REST API design

Preferred:
- React or Vue.js for internal tools
- GraphQL experience
- Some machine learning (ML) background
"""

KEYWORDS_BACKEND = [
    "Python", "Django", "PostgreSQL", "Redis", "AWS", "EC2", "S3", "Lambda",
    "Docker", "Kubernetes", "CI/CD", "REST API", "React", "Vue.js", "GraphQL",
    "Machine Learning",
]

TAILORED_RESUME = """\
Senior backend engineer with 6 years building scalable Python services on Django.
Deep experience with PostgreSQL and Redis. Deployed to AWS using EC2, S3, Lambda.
Built CI/CD pipelines with Docker and Kubernetes for microservice deployments.
Designed REST API systems serving millions of requests. Internal tools in React.
"""

MASTER_RESUME = """\
Software engineer with experience in Python, Java, and JavaScript.
Built web applications and APIs. Worked with various databases.
Used cloud services for deployment.
"""

OFF_TARGET_RESUME = """\
Frontend designer with 3 years of HTML, CSS, and Photoshop experience.
Built marketing landing pages and managed social media campaigns.
"""


# ---------------------------------------------------------------------------
# Score range tests
# ---------------------------------------------------------------------------

def test_tailored_resume_scores_in_industry_band():
    """A well-tailored resume should land in Jobscan's 70-95% band."""
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    assert 0.70 <= result["overall"] <= 0.95, (
        f"Tailored resume should score 70-95%, got {result['overall']:.0%}. "
        "If this fails after intentional weight changes, update the bound — "
        "do not widen it just to pass."
    )


def test_master_resume_scores_low():
    """A generic, untailored resume should score noticeably lower than tailored."""
    tailored = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    master = score_resume(MASTER_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    assert master["overall"] < tailored["overall"] - 0.30, (
        f"Master ({master['overall']:.0%}) should be at least 30 pts below "
        f"tailored ({tailored['overall']:.0%}); the scorer isn't differentiating."
    )


def test_off_target_resume_scores_near_zero():
    """A frontend designer applying to a backend role should score near zero."""
    result = score_resume(OFF_TARGET_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    assert result["overall"] < 0.15, (
        f"Off-target resume should score <15%, got {result['overall']:.0%}."
    )


def test_score_ordering_is_correct():
    """Tailored > Master > Off-target. The whole point of the scorer."""
    t = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)["overall"]
    m = score_resume(MASTER_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)["overall"]
    o = score_resume(OFF_TARGET_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)["overall"]
    assert t > m > o, f"Expected tailored ({t}) > master ({m}) > off-target ({o})"


def test_overall_capped_under_100_pct():
    """Even a JD-mirrored resume should not score 100% (anti-stuffing)."""
    perfect_resume = JD_BACKEND  # literally the JD as the resume
    result = score_resume(perfect_resume, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    assert result["overall"] <= 0.98, (
        f"Score should cap below 100% to discourage stuffing; got {result['overall']:.0%}"
    )


# ---------------------------------------------------------------------------
# Breakdown structure tests
# ---------------------------------------------------------------------------

def test_breakdown_returns_expected_keys():
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    expected = {
        "overall", "skills_match", "keyword_coverage",
        "matched_required", "missing_required",
        "matched_preferred", "missing_preferred",
        "stats",
    }
    assert expected.issubset(result.keys())


def test_required_classification_uses_required_section_proximity():
    """Keywords sitting near 'Required:' should be classified required."""
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    required = set(result["matched_required"] + result["missing_required"])
    # python/django/postgresql sit in the Required block — must be classified required
    for kw in ("python", "django", "postgresql"):
        assert kw in required, f"{kw} should be classified as required"


def test_preferred_classification_for_nice_to_haves():
    """Keywords sitting in the Preferred block should be preferred (not required)."""
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    preferred = set(result["matched_preferred"] + result["missing_preferred"])
    # graphql is only in the Preferred block in the JD
    assert "graphql" in preferred, "graphql should be classified preferred"


def test_missing_required_surface_is_actionable():
    """The 'missing required' list should drive concrete UI affordances.

    Note: 'machine learning (ML)' in the JD canonicalizes to two mentions of
    the same term, so it's classified required by the frequency heuristic.
    The resume doesn't mention ML at all, so we expect it in missing_required.
    """
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    all_missing = result["missing_required"] + result["missing_preferred"]
    assert "machine-learning" in all_missing, (
        f"machine-learning should be missing from this resume. Got: "
        f"missing_required={result['missing_required']}, "
        f"missing_preferred={result['missing_preferred']}"
    )


# ---------------------------------------------------------------------------
# Aliasing / canonicalization tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("alias,canonical", [
    ("js", "javascript"),
    ("k8s", "kubernetes"),
    ("ml", "machine-learning"),
    ("react.js", "react"),
    ("ci/cd", "ci-cd"),
    ("postgres", "postgresql"),
    ("c++", "cpp"),
    ("c#", "csharp"),
    ("node.js", "nodejs"),
])
def test_keyword_canonicalization(alias, canonical):
    assert canonicalize_keyword(alias) == canonical


def test_text_canonicalization_handles_aliases():
    text = "Built APIs with Node.js and deployed to k8s. Used React.js for frontend."
    out = canonicalize_text(text)
    assert "nodejs" in out
    assert "kubernetes" in out
    assert "react" in out
    # Originals should be replaced
    assert "node.js" not in out
    assert "k8s" not in out


def test_alias_match_via_resume_using_synonym():
    """Resume saying 'k8s' should match keyword 'Kubernetes' via aliases."""
    resume = "Deployed services to k8s clusters with terraform and managed JS bundles."
    keywords = ["Kubernetes", "Terraform", "JavaScript"]
    jd = "Required: Kubernetes, Terraform, JavaScript"
    result = score_resume(resume, jd, keywords=keywords)
    matched = result["matched_required"] + result["matched_preferred"]
    assert "kubernetes" in matched, "k8s in resume should match Kubernetes keyword"
    assert "javascript" in matched, "JS in resume should match JavaScript keyword"
    assert "terraform" in matched


# ---------------------------------------------------------------------------
# Fallback path (when no AI keywords available)
# ---------------------------------------------------------------------------

def test_fallback_extraction_still_produces_meaningful_score():
    """Without ai_keywords, scorer falls back to JD-based frequency extraction."""
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=None)
    assert result["overall"] > 0.10, "Fallback should still score above zero"
    assert result["stats"]["used_ai_keywords"] is False


def test_with_ai_keywords_marks_used_ai_keywords_true():
    result = score_resume(TAILORED_RESUME, JD_BACKEND, keywords=KEYWORDS_BACKEND)
    assert result["stats"]["used_ai_keywords"] is True


# ---------------------------------------------------------------------------
# extract_resume_text tests (used by gap_analysis)
# ---------------------------------------------------------------------------

def test_extract_resume_text_pulls_all_textual_content():
    tailored = {
        "summary": "Backend engineer.",
        "experience": [
            {"role": "Senior SWE", "company": "Acme",
             "bullets": ["Built Python services", {"text": "Shipped Docker"}]},
        ],
        "skills": {"Languages": ["Python", "Go"], "Tools": ["Docker"]},
        "projects": [{"name": "ProjectX", "description": "AI tool"}],
    }
    text = extract_resume_text(tailored)
    for token in ("Backend engineer", "Senior SWE", "Built Python", "Shipped Docker",
                  "Python", "Go", "Docker", "ProjectX", "AI tool"):
        assert token in text, f"missing {token!r}"
