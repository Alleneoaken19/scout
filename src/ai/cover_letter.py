"""Cover letter generator -- writes a natural, human-sounding cover letter per job."""

from rich.console import Console

from src.ai.anthropic_client import AICallError, call_json, wrap_user_input

console = Console()

SYSTEM_PROMPT = """\
You write cover letters that sound like a real person wrote them — warm, specific, and genuine.

RULES:
1. Write in first person. Sound like a confident professional, not a robot or a salesperson.
2. NEVER use: "I am writing to express my interest", "I am excited to apply", "I believe I am \
an ideal candidate", "I am confident that", "passionate about leveraging", "thrilled", \
"eager to contribute". These are dead giveaways of AI-written text.
3. Open with something specific — why this company or role caught your attention. \
Reference something real about the company if the JD mentions it.
4. Middle: connect 2-3 specific things you've done to what the role needs. Be concrete \
(mention the project, the metric, the technology) not generic.
5. Close naturally — express genuine interest in talking further. Keep it simple.
6. Total length: 150-250 words. Three short paragraphs. No filler.
7. Tone: professional but human. Like an email you'd send to someone you respect.
8. Return ONLY valid JSON. No markdown fences."""

USER_PROMPT_TEMPLATE = """\
Job title: {title}
Company: {company}

Job description:
{jd_text}
{research_notes_section}
Candidate's background summary:
{summary}

Candidate's key skills: {skills}

Write a cover letter. Return exactly this JSON:
{{"cover_letter": "the full cover letter text"}}"""


def generate_cover_letter(
    title: str,
    company: str,
    jd_text: str,
    summary: str,
    skills: list[str],
    research_notes: str = "",
) -> str:
    """Generate a tailored cover letter. Returns the cover letter text."""
    research_notes_section = ""
    if research_notes and research_notes.strip():
        research_notes_section = (
            "\nAdditional context and research about this role/company:\n"
            f"{research_notes.strip()[:2000]}\n"
        )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        title=title,
        company=company,
        jd_text=wrap_user_input("job_description", jd_text[:3000]),
        summary=summary,
        skills=", ".join(skills[:15]),
        research_notes_section=wrap_user_input("research_notes", research_notes_section) if research_notes_section else "",
    )

    try:
        result = call_json(SYSTEM_PROMPT, user_prompt)
    except AICallError as e:
        console.print(f"  [yellow]Cover letter generation failed: {e}[/yellow]")
        return ""

    cover_letter = result.get("cover_letter", "")
    if not isinstance(cover_letter, str) or not cover_letter.strip():
        console.print("  [yellow]AI returned empty cover letter[/yellow]")
        return ""

    return cover_letter.strip()
