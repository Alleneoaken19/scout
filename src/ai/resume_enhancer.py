"""AI resume enhancer — suggests improvements to the master resume."""

import json

from src.ai.anthropic_client import AICallError, call_json, wrap_user_input

SYSTEM_PROMPT = """\
You are a senior resume consultant. Analyze a resume and suggest specific improvements.

RULES:
1. NEVER suggest adding experience, companies, or metrics the candidate doesn't have.
2. You CAN suggest skills the candidate likely has based on their experience context \
(e.g., if they managed a kitchen, they likely used POS systems; if they used Kotlin + Android, they likely used Gradle)
3. For bullet rewrites, keep the SAME achievement but improve clarity, add action verbs, \
and suggest where quantification might be possible ("How many users? What % improvement?")
4. Write like a human — no buzzwords.
5. Be specific, not generic. "Add Docker" is better than "Add more DevOps skills."
6. Focus on what will actually improve ATS scores for the candidate's target roles."""

USER_PROMPT_TEMPLATE = """\
Resume:
{resume_json}

Target job titles: {job_titles}

Most frequently required skills in the job market that are MISSING from this resume:
{missing_skills}

Return exactly this JSON:
{{
  "bullet_rewrites": [
    {{
      "experience_index": 0,
      "bullet_index": 0,
      "original": "the original bullet text",
      "suggested": "improved version with stronger verb and quantification prompt",
      "reason": "why this change helps"
    }}
  ],
  "missing_skills_to_add": [
    {{
      "skill": "Docker",
      "reason": "You used CI/CD at d.light — you likely used Docker for containerization",
      "confidence": "high"
    }}
  ],
  "summary_rewrite": {{
    "original": "current summary",
    "suggested": "improved summary",
    "reason": "why"
  }},
  "general_tips": [
    "Specific actionable tip about the resume"
  ]
}}

Suggest 3-5 bullet rewrites (focus on the weakest bullets), 3-8 missing skills to add, \
and 2-3 general tips. Only suggest skills with high or medium confidence."""


def enhance_resume(master_resume: dict, missing_skills: list[str], job_titles: list[str]) -> dict:
    """Analyze master resume and return enhancement suggestions.

    Args:
        master_resume: The full master resume dict
        missing_skills: High-demand skills missing from resume (from gap analysis)
        job_titles: User's target job titles (from preferences)

    Returns dict with suggestions, or error.
    """
    resume_json = json.dumps(master_resume, indent=2)[:6000]
    missing_str = ", ".join(missing_skills[:20]) if missing_skills else "none identified yet"
    titles_str = ", ".join(job_titles[:5]) if job_titles else "general professional roles"

    user_prompt = USER_PROMPT_TEMPLATE.format(
        resume_json=wrap_user_input("resume_data", resume_json),
        missing_skills=missing_str,
        job_titles=titles_str,
    )

    try:
        result = call_json(SYSTEM_PROMPT, user_prompt, max_tokens=4096)
    except AICallError as e:
        return {"error": str(e)}

    # Validate structure
    if not isinstance(result.get("bullet_rewrites"), list):
        result["bullet_rewrites"] = []
    if not isinstance(result.get("missing_skills_to_add"), list):
        result["missing_skills_to_add"] = []
    if not isinstance(result.get("general_tips"), list):
        result["general_tips"] = []

    return result
