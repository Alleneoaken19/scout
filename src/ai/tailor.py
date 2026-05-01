"""Resume tailoring — rewrites master resume to match JD language and structure."""

import json
from typing import Any

from rich.console import Console

from src.ai.anthropic_client import AICallError, call_json, wrap_user_input
from src.paths import RESUME_DIR

console = Console()

RESUME_PATH = RESUME_DIR / "master.json"

SYSTEM_PROMPT_TEMPLATE = """\
You are a resume editor. You rewrite and select existing resume content to match a job description.

RULES:
1. NEVER fabricate experience, companies, metrics, certifications, or credentials the candidate did not mention.
2. Write like a human — avoid overused buzzwords like {buzzwords}. Use plain, direct language.
3. Every bullet must start with a past-tense action verb ({action_verbs}).
4. Prefer bullets with quantified impact (percentages, counts, time saved). Keep original numbers exactly.
5. Each role gets 3-5 bullets. Pick the most relevant to the target JD. Reword to echo the JD's \
terminology while staying truthful.
6. Summary must be exactly 2-3 concise sentences. First sentence: who you are + years of experience \
+ primary focus. Second: key strengths relevant to THIS role. Optional third: a standout achievement.
7. Categorize skills into: {skill_categories}.
8. Select 2-3 most relevant projects. One-sentence descriptions.
9. NEVER alter certifications, licenses, or credential details — reproduce them exactly as given.
10. Return ONLY valid JSON. No markdown fences. No commentary."""

USER_PROMPT_TEMPLATE = """\
Target job description:
{jd_text}
{research_notes_section}
ATS keywords to incorporate where truthful:
{ats_keywords}

My complete resume data:
{master_resume_json}

Rewrite my resume for this specific role. Return this exact JSON structure:
{{
  "summary": "2-3 sentence summary tailored to this role",
  "experience": [
    {{
      "role": "exact role title from my resume",
      "company": "exact company name",
      "location": "location",
      "start_date": "YYYY-MM",
      "end_date": "present or YYYY-MM",
      "bullets": ["rewritten bullet 1", "rewritten bullet 2", "rewritten bullet 3"]
    }}
  ],
  "skills": {{
    "Languages": [],
    "Frameworks & Libraries": [],
    "Tools & Infrastructure": [],
    "Practices": []
  }},
  "projects": [
    {{
      "name": "project name",
      "description": "one-sentence description tailored to this role"
    }}
  ]
}}

IMPORTANT:
- Include ALL roles from my experience. For the most recent/relevant role, include up to 5 bullets. \
For older roles, 2-3 bullets. Reword bullets to echo the JD language but never fabricate.
- Include ALL skills from my resume in the skills section — do NOT drop any. \
Categorize and reorder them so the most JD-relevant skills appear first in each category.
- Incorporate the ATS keywords naturally into bullets and summary where truthful."""


def load_master_resume() -> dict[str, Any]:
    """Load the master resume JSON."""
    if not RESUME_PATH.exists():
        raise FileNotFoundError(f"Master resume not found at {RESUME_PATH}")
    data = json.loads(RESUME_PATH.read_text())
    if not isinstance(data, dict):
        raise ValueError(f"Master resume must be a JSON object, got {type(data).__name__}")
    return data


def _master_to_new_format(master: dict) -> dict:
    """Convert master resume to the new tailored format as fallback."""
    experience = []
    for exp in master.get("experience", []):
        experience.append({
            "role": exp.get("role", ""),
            "company": exp.get("company", ""),
            "location": exp.get("location", ""),
            "start_date": exp.get("start_date", ""),
            "end_date": exp.get("end_date", ""),
            "bullets": [
                b.get("text", "") if isinstance(b, dict) else str(b)
                for b in exp.get("bullets", [])
                if (b.get("text") if isinstance(b, dict) else b)
            ],
        })

    skills_list = master.get("skills", [])
    skills = {"Technical Skills": skills_list} if skills_list else {}

    projects = [
        {"name": p.get("name", ""), "description": p.get("description", "")}
        for p in master.get("projects", [])[:3]
    ]

    return {
        "summary": master.get("summary", ""),
        "experience": experience,
        "skills": skills,
        "projects": projects,
    }


def _validate_experience(experience: Any) -> list[dict] | None:
    """Validate experience is a list of role dicts with bullets. Returns None if invalid."""
    if not isinstance(experience, list):
        return None
    validated = []
    for exp in experience:
        if not isinstance(exp, dict):
            continue
        if not exp.get("role") or not exp.get("company"):
            continue
        bullets = exp.get("bullets", [])
        if not isinstance(bullets, list):
            continue
        clean_bullets = [b for b in bullets if isinstance(b, str) and b.strip()]
        if not clean_bullets:
            continue
        validated.append({
            "role": exp["role"],
            "company": exp["company"],
            "location": exp.get("location", ""),
            "start_date": exp.get("start_date", ""),
            "end_date": exp.get("end_date", ""),
            "bullets": clean_bullets,
        })
    return validated if validated else None


def _validate_skills(skills: Any) -> dict | None:
    """Validate skills is a dict of category -> list. Returns None if invalid."""
    if isinstance(skills, dict):
        cleaned = {}
        for cat, items in skills.items():
            if isinstance(items, list):
                clean = [s for s in items if isinstance(s, str) and s.strip()]
                if clean:
                    cleaned[cat] = clean
        return cleaned if cleaned else None
    return None


def _validate_projects(projects: Any) -> list[dict]:
    """Validate projects list."""
    if not isinstance(projects, list):
        return []
    validated = []
    for p in projects:
        if isinstance(p, dict) and p.get("name"):
            validated.append({
                "name": p["name"],
                "description": p.get("description", ""),
            })
    return validated[:3]


def _merge_master_skills(tailored_skills: dict, master_skills: list | dict) -> dict:
    """Ensure no master resume skills are lost during tailoring.

    The AI sometimes drops skills it deems irrelevant, but those skills
    help ATS scoring. This merges them back under an 'Additional' category.
    """
    # Collect all skills already in the tailored output
    existing: set[str] = set()
    for items in tailored_skills.values():
        existing.update(s.lower() for s in items)

    # Collect all master skills
    all_master: list[str] = []
    if isinstance(master_skills, list):
        all_master = master_skills
    elif isinstance(master_skills, dict):
        for items in master_skills.values():
            if isinstance(items, list):
                all_master.extend(items)

    # Find dropped skills
    dropped = [s for s in all_master if s.lower() not in existing]
    if dropped:
        tailored_skills.setdefault("Additional", []).extend(dropped)

    return tailored_skills


def tailor_resume(jd_text: str, ats_keywords: list[str], research_notes: str = "") -> dict[str, Any]:
    """Tailor the master resume for a specific JD. Returns tailored JSON."""
    from src.domain import detect_domain, get_action_verbs, get_skill_categories, DOMAIN_BUZZWORDS
    from src.preferences import load_preferences

    master = load_master_resume()

    # Detect domain for domain-aware prompt
    prefs = load_preferences()
    domain = detect_domain(prefs.job_titles)
    skill_cats = ", ".join(get_skill_categories(domain))
    action_verbs = get_action_verbs(domain)
    buzzwords = ", ".join(f'"{b}"' for b in DOMAIN_BUZZWORDS.get(domain, DOMAIN_BUZZWORDS["general"])[:5])

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        buzzwords=buzzwords,
        action_verbs=action_verbs,
        skill_categories=skill_cats,
    )

    research_notes_section = ""
    if research_notes and research_notes.strip():
        research_notes_section = (
            "\nAdditional context and research about this role/company:\n"
            f"{research_notes.strip()[:3000]}\n"
        )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        jd_text=wrap_user_input("job_description", jd_text[:5000]),
        ats_keywords=json.dumps(ats_keywords),
        master_resume_json=json.dumps(master, indent=2),
        research_notes_section=wrap_user_input("research_notes", research_notes_section) if research_notes_section else "",
    )

    fallback = _master_to_new_format(master)

    try:
        result = call_json(system_prompt, user_prompt, max_tokens=4096)
    except AICallError as e:
        console.print(f"  [yellow]AI tailoring failed: {e}[/yellow]")
        console.print("  [dim]Falling back to master resume content[/dim]")
        result = {}

    # Validate each field, falling back to master data
    summary = result.get("summary", "")
    if not summary or not isinstance(summary, str):
        summary = fallback["summary"]

    experience = _validate_experience(result.get("experience"))
    if not experience:
        console.print("  [yellow]AI returned invalid experience — using master resume[/yellow]")
        experience = fallback["experience"]

    skills = _validate_skills(result.get("skills"))
    if not skills:
        skills = fallback["skills"]

    # Safety net: merge any master skills the AI dropped back in
    skills = _merge_master_skills(skills, master.get("skills", []))

    projects = _validate_projects(result.get("projects"))
    if not projects:
        projects = fallback["projects"]

    tailored = {
        "personal": master.get("personal", {}),
        "summary": summary,
        "experience": experience,
        "skills": skills,
        "education": master.get("education", []),
        "projects": projects,
        "certifications": master.get("certifications", []),
        "languages": master.get("languages", []),
    }

    # Fabrication detection: verify tailored content against master
    warnings = _detect_fabrication(tailored, master)
    if warnings:
        console.print("  [yellow]Fabrication warnings:[/yellow]")
        for w in warnings:
            console.print(f"    [yellow]- {w}[/yellow]")
    tailored["_fabrication_warnings"] = warnings

    return tailored


def _detect_fabrication(tailored: dict, master: dict) -> list[str]:
    """Compare tailored resume against master to flag potentially fabricated content.

    Returns a list of warning strings. Empty list means no issues detected.
    """
    warnings: list[str] = []

    # 1. Check for companies not in master resume
    master_companies = {
        exp.get("company", "").lower().strip()
        for exp in master.get("experience", [])
    }
    for exp in tailored.get("experience", []):
        company = exp.get("company", "").lower().strip()
        if company and company not in master_companies:
            warnings.append(f"New company not in master resume: '{exp.get('company')}'")

    # 2. Check for roles not in master resume
    master_roles = {
        exp.get("role", "").lower().strip()
        for exp in master.get("experience", [])
    }
    for exp in tailored.get("experience", []):
        role = exp.get("role", "").lower().strip()
        if role and role not in master_roles:
            warnings.append(f"New role not in master resume: '{exp.get('role')}'")

    # 3. Check for new quantified metrics (numbers/percentages not in master)
    import re
    master_numbers: set[str] = set()
    for exp in master.get("experience", []):
        for bullet in exp.get("bullets", []):
            text = bullet.get("text", "") if isinstance(bullet, dict) else str(bullet)
            master_numbers.update(re.findall(r'\d+(?:\.\d+)?%?', text))
    master_numbers.update(re.findall(r'\d+(?:\.\d+)?%?', master.get("summary", "")))

    for exp in tailored.get("experience", []):
        for bullet in exp.get("bullets", []):
            if isinstance(bullet, str):
                new_numbers = set(re.findall(r'\d+(?:\.\d+)?%?', bullet))
                fabricated = new_numbers - master_numbers
                # Filter out very small/common numbers (1, 2, 3) to reduce noise
                fabricated = {n for n in fabricated if len(n) > 1 or n.endswith('%')}
                if fabricated:
                    warnings.append(
                        f"New metric(s) in bullet: {fabricated} — verify against master resume"
                    )

    return warnings
