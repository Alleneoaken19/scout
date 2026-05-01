"""Lever ATS apply bot — fills application forms on jobs.lever.co."""

from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout
from rich.console import Console

from src.apply.answers_store import get_answer, record_unknown_question
from src.apply.apply_logger import log_action
from src.apply.base_bot import fill_input_field, human_delay

console = Console()
PORTAL = "lever"


def apply_lever(
    page: Page,
    url: str,
    job_id: str,
    resume_path: str | None,
    cover_letter: str | None,
    dry_run: bool = True,
) -> bool:
    """Fill and optionally submit a Lever application form."""
    console.print("    [cyan]Opening Lever form...[/cyan]")

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
    except PlaywrightTimeout:
        console.print("    [red]Page load timed out[/red]")
        log_action(job_id, PORTAL, "timeout", {"url": url}, dry_run)
        return False

    human_delay(2, 4)

    # Click "Apply for this job" if present
    apply_btn = page.query_selector('a.postings-btn, a[href*="apply"], .apply-button')
    if apply_btn and apply_btn.is_visible():
        href = apply_btn.get_attribute("href")
        if href:
            full_url = href if href.startswith("http") else urljoin(url, href)
            try:
                page.goto(full_url, wait_until="domcontentloaded", timeout=30000)
            except PlaywrightTimeout:
                console.print("    [red]Apply page timed out[/red]")
                return False
        else:
            apply_btn.click(timeout=10000)
        human_delay(2, 3)

    log_action(job_id, PORTAL, "opened_form", {"url": url}, dry_run)

    # --- Personal info (one attempt per field, stop on first match) ---
    fields = [
        ("full_name", ['input[name="name"]']),
        ("email", ['input[name="email"]']),
        ("phone", ['input[name="phone"]']),
        ("current_company", ['input[name="org"]']),
        ("linkedin", ['input[name="urls[LinkedIn]"]']),
        ("github", ['input[name="urls[GitHub]"]']),
        ("website_url", ['input[name="urls[Portfolio]"]']),
    ]

    filled_fields = []
    for answer_key, selectors in fields:
        answer = get_answer(PORTAL, answer_key)
        if not answer:
            continue
        for selector in selectors:
            if fill_input_field(page, selector, answer):
                filled_fields.append(answer_key)
                human_delay(0.5, 1.0)
                break

    console.print(f"    [dim]Filled {len(filled_fields)} fields: {', '.join(filled_fields)}[/dim]")
    log_action(job_id, PORTAL, "filled_fields", {"fields": filled_fields}, dry_run)

    # --- Resume upload ---
    if resume_path and Path(resume_path).exists():
        try:
            file_input = page.query_selector(
                'input[type="file"][name="resume"], input[type="file"]'
            )
            if file_input:
                file_input.set_input_files(resume_path)
                console.print("    [green]Resume uploaded[/green]")
                log_action(job_id, PORTAL, "resume_uploaded", {"path": resume_path}, dry_run)
                human_delay(1, 2)
            else:
                console.print("    [yellow]No file input found[/yellow]")
        except Exception as e:
            console.print(f"    [yellow]Resume upload failed: {e}[/yellow]")

    # --- Cover letter (targeted selectors only) ---
    if cover_letter:
        cover_selectors = [
            'textarea[name="comments"]',
            'textarea[name="coverLetter"]',
            'textarea[name*="cover"]',
            'textarea[aria-label*="cover letter" i]',
        ]
        for selector in cover_selectors:
            try:
                field = page.query_selector(selector)
                if field and field.is_visible():
                    field.fill(cover_letter)
                    console.print("    [green]Cover letter filled[/green]")
                    log_action(job_id, PORTAL, "cover_letter_filled", {}, dry_run)
                    human_delay(0.5, 1.0)
                    break
            except Exception:
                continue

    # --- Custom questions ---
    _handle_custom_questions(page, job_id, dry_run)

    # --- Submit ---
    if dry_run:
        console.print("    [yellow]DRY RUN — form filled, NOT submitting[/yellow]")
        log_action(job_id, PORTAL, "dry_run_complete", {}, dry_run)
        return True

    submit_selectors = [
        'button[type="submit"]',
        '.postings-btn-submit',
        'button.template-btn-submit',
        'button:has-text("Submit application")',
        'button:has-text("Submit")',
    ]
    for selector in submit_selectors:
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                human_delay(1, 2)
                btn.click()
                console.print("    [green]Application submitted![/green]")
                log_action(job_id, PORTAL, "submitted", {}, dry_run)
                human_delay(2, 4)
                return True
        except Exception:
            continue

    console.print("    [yellow]Submit button not found[/yellow]")
    log_action(job_id, PORTAL, "submit_button_not_found", {}, dry_run)
    return False


def _handle_custom_questions(page: Page, job_id: str, dry_run: bool) -> None:
    """Attempt to answer custom Lever questions."""
    question_divs = page.query_selector_all(
        ".application-question, .custom-question, div[class*='question']"
    )

    answered = 0
    unknown = 0

    for div in question_divs:
        try:
            label = div.query_selector("label, .question-label")
            if not label:
                continue

            label_text = label.inner_text().strip()
            if not label_text or len(label_text) < 3:
                continue

            answer = get_answer(PORTAL, label_text)

            input_el = div.query_selector("input:not([type='file']):not([type='hidden']), textarea, select")
            if not input_el or not input_el.is_visible():
                continue

            tag = input_el.evaluate("el => el.tagName").lower()
            input_type = input_el.get_attribute("type") or ""

            if answer:
                if tag == "select":
                    try:
                        input_el.select_option(label=answer)
                    except Exception:
                        try:
                            input_el.select_option(value=answer)
                        except Exception:
                            continue
                elif input_type in ("checkbox", "radio"):
                    if answer.lower() in ("yes", "true", "1"):
                        input_el.check()
                else:
                    input_el.fill(answer)

                human_delay(0.3, 0.7)
                answered += 1
                log_action(job_id, PORTAL, "answered_question",
                           {"question": label_text, "answer": answer}, dry_run)
            else:
                unknown += 1
                record_unknown_question(PORTAL, label_text)
                log_action(job_id, PORTAL, "unknown_question",
                           {"question": label_text}, dry_run)
        except Exception:
            continue

    if answered or unknown:
        console.print(f"    [dim]Custom questions: {answered} answered, {unknown} unknown[/dim]")
