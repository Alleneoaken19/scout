"""Domain detection and domain-specific configuration.

Provides career-domain awareness across the system: skill categories,
action verbs, auto-apply policy, scraper selection, and scoring config.
"""

from __future__ import annotations

# Keywords that indicate a career domain based on job titles
DOMAIN_KEYWORDS: dict[str, set[str]] = {
    "technology": {
        "software", "developer", "engineer", "devops", "frontend", "backend",
        "fullstack", "full-stack", "data", "ml", "ai", "cloud", "sre", "web",
        "react", "python", "java", "kotlin", "flutter", "mobile", "android",
        "ios", "platform", "infrastructure", "security", "cybersecurity",
        "qa", "sdet", "database", "dba", "embedded", "firmware",
    },
    "medical": {
        "nurse", "nursing", "rn", "lpn", "np", "physician", "doctor", "md",
        "clinical", "medical", "healthcare", "hospital", "patient", "icu",
        "emergency", "surgical", "dental", "pharmacy", "therapist", "therapy",
        "radiology", "laboratory", "paramedic", "emt", "midwife", "dietitian",
        "cna", "caregiver", "oncology", "pediatric", "geriatric",
    },
    "hospitality": {
        "chef", "cook", "hotel", "restaurant", "server", "waiter", "waitress",
        "bartender", "hospitality", "catering", "barista", "housekeeper",
        "concierge", "sommelier", "pastry", "kitchen", "sous", "culinary",
        "banquet", "housekeeping", "front desk", "bellhop", "hostess",
    },
    "education": {
        "teacher", "teaching", "instructor", "professor", "lecturer", "educator",
        "school", "curriculum", "faculty", "tutor", "academic", "principal",
        "counselor", "librarian", "dean", "superintendent", "paraprofessional",
        "aide", "preschool", "kindergarten", "elementary", "secondary",
    },
}

# Skills categories for resume tailoring per domain
SKILL_CATEGORIES: dict[str, list[str]] = {
    "technology": ["Languages", "Frameworks & Libraries", "Tools & Infrastructure", "Practices"],
    "medical": ["Clinical Skills", "Certifications & Licenses", "Systems & Equipment", "Specialties"],
    "hospitality": ["Service Skills", "Certifications", "Systems & Tools", "Management"],
    "education": ["Subject Expertise", "Pedagogy & Methods", "Technology Integration", "Certifications"],
    "general": ["Professional Skills", "Certifications", "Tools & Software", "Competencies"],
}

# Action verbs for resume bullets per domain
ACTION_VERBS: dict[str, str] = {
    "technology": (
        "Built, Integrated, Reduced, Migrated, Led, Automated, Designed, "
        "Implemented, Shipped, Maintained, Optimized, Collaborated, Deployed, Refactored"
    ),
    "medical": (
        "Assessed, Administered, Monitored, Coordinated, Managed, Provided, "
        "Documented, Educated, Implemented, Collaborated, Evaluated, Improved, Triaged, Supervised"
    ),
    "hospitality": (
        "Managed, Supervised, Trained, Coordinated, Served, Prepared, "
        "Maintained, Improved, Organized, Implemented, Developed, Resolved, Oversaw, Planned"
    ),
    "education": (
        "Taught, Developed, Assessed, Mentored, Facilitated, Designed, "
        "Implemented, Collaborated, Differentiated, Evaluated, Created, Led, Integrated, Supported"
    ),
    "general": (
        "Managed, Led, Developed, Implemented, Coordinated, Improved, "
        "Analyzed, Organized, Created, Maintained, Collaborated, Delivered, Resolved, Planned"
    ),
}

# Domains where auto-apply should be blocked due to regulatory requirements
REGULATED_DOMAINS = {"medical", "education"}

# Anti-buzzwords per domain (for cover letter and resume tailoring)
DOMAIN_BUZZWORDS: dict[str, list[str]] = {
    "technology": [
        "Proven expertise", "Demonstrated success", "Spearheaded", "Leveraged",
        "innovative solutions", "cutting-edge", "Strong track record",
    ],
    "medical": [
        "Enhanced patient outcomes", "Improved care coordination",
        "Driven by compassion", "Passionate about patient care",
    ],
    "hospitality": [
        "Elevated guest experience", "Driving occupancy",
        "Optimized F&B operations", "Passionate about exceeding expectations",
    ],
    "education": [
        "Student-centered learning", "Fostered critical thinking",
        "Committed to fostering student growth", "Innovative pedagogical approaches",
    ],
    "general": [
        "Proven track record", "Results-driven", "Self-starter",
        "Detail-oriented", "Passionate about", "Dynamic leader",
    ],
}


def detect_domain(job_titles: list[str]) -> str:
    """Detect user's career domain from their preferred job titles.

    Returns one of: "technology", "medical", "hospitality", "education", "general"
    """
    if not job_titles:
        return "general"

    title_words: set[str] = set()
    for t in job_titles:
        title_words.update(t.lower().split())

    scores = {
        domain: len(title_words & keywords)
        for domain, keywords in DOMAIN_KEYWORDS.items()
    }
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def get_skill_categories(domain: str) -> list[str]:
    """Get resume skill categories for a domain."""
    return SKILL_CATEGORIES.get(domain, SKILL_CATEGORIES["general"])


def get_action_verbs(domain: str) -> str:
    """Get action verbs for resume bullets for a domain."""
    return ACTION_VERBS.get(domain, ACTION_VERBS["general"])


def is_regulated(domain: str) -> bool:
    """Check if a domain requires manual application review (no auto-apply)."""
    return domain in REGULATED_DOMAINS
