"""Workday ATS apply bot — fills application forms on myworkdayjobs.com.

Workday forms are complex multi-step SPAs. This handles the common patterns
but may require manual completion for unusual form layouts.
"""

from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout
from rich.console import Console

from src.apply.answers_store import get_answer, record_unknown_question
from src.apply.apply_logger import log_action
from src.apply.base_bot import fill_input_field, human_delay

console = Console()
PORTAL = "workday"

# Max steps to attempt in Workday's multi-step flow
MAX_STEPS = 5


def apply_workday(
    page: Page,
    url: str,
    job_id: str,
    resume_path: str | None,
    cover_letter: str | None,
    dry_run: bool = True,
) -> bool:
    """Fill and optionally submit a Workday application form."""
    console.print("    [cyan]Opening Workday form...[/cyan]")

    try:
        page.goto(url, wait_until="networkidle", timeout=30000)
    except PlaywrightTimeout:
        console.print("    [red]Page load timed out[/red]")
        log_action(job_id, PORTAL, "timeout", {"url": url}, dry_run)
        return False

    human_delay(3, 5)

    # Click "Apply" button if we're on the job detail page
    for selector in [
        'a[data-automation-id="jobPostingApplyButton"]',
        'button[data-automation-id="jobPostingApplyButton"]',
    ]:
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click()
                human_delay(3, 5)
                break
        except Exception:
            continue

    # Click "Apply Manually" if autofill options appear
    for selector in [
        'button[data-automation-id="applyManually"]',
        'a[data-automation-id="applyManually"]',
    ]:
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click()
                human_delay(2, 4)
                break
        except Exception:
            continue

    log_action(job_id, PORTAL, "opened_form", {"url": url}, dry_run)

    # Try to skip account creation
    _try_continue_without_account(page)

    # --- Fill form across multiple steps ---
    resume_uploaded = False
    total_filled = 0

    for step in range(1, MAX_STEPS + 1):
        console.print(f"    [dim]Step {step}...[/dim]")

        # Fill personal info fields on current step
        filled = _fill_workday_fields(page)
        total_filled += len(filled)

        # Upload resume if file input is visible and not yet uploaded
        if resume_path and not resume_uploaded:
            resume_uploaded = _upload_resume(page, resume_path, job_id, dry_run)

        # Handle custom questions on current step
        _handle_custom_questions(page, job_id, dry_run)

        # Check for final submit button
        submit_btn = page.query_selector('button[data-automation-id="submit"]')
        if submit_btn and submit_btn.is_visible():
            if dry_run:
                console.print(f"    [yellow]DRY RUN — form filled ({total_filled} fields), NOT submitting[/yellow]")
                log_action(job_id, PORTAL, "dry_run_complete", {"steps": step, "filled": total_filled}, dry_run)
                return True

            human_delay(1, 2)
            try:
                submit_btn.click()
                console.print("    [green]Application submitted![/green]")
                log_action(job_id, PORTAL, "submitted", {"steps": step}, dry_run)
                human_delay(3, 5)
                return True
            except Exception as e:
                console.print(f"    [yellow]Submit failed: {e}[/yellow]")
                return False

        # Try to advance to next step
        next_btn = page.query_selector(
            'button[data-automation-id="bottom-navigation-next-button"]'
        )
        if next_btn and next_btn.is_visible():
            try:
                next_btn.click()
                human_delay(2, 4)
            except Exception:
                break
        else:
            # No next button and no submit button — we're stuck
            break

    console.print(f"    [yellow]Reached step limit — filled {total_filled} fields[/yellow]")
    console.print("    [dim]You may need to complete remaining steps manually[/dim]")
    log_action(job_id, PORTAL, "partial_fill", {"filled": total_filled}, dry_run)

    if dry_run:
        return True  # Partial fill is still considered success for dry run
    return False


def _fill_workday_fields(page: Page) -> list[str]:
    """Fill standard Workday fields on the current step."""
    fields = [
        ("legal_first_name", ['input[data-automation-id="legalNameSection_firstName"]']),
        ("legal_last_name", ['input[data-automation-id="legalNameSection_lastName"]']),
        ("email", ['input[data-automation-id="email"]']),
        ("phone_number", ['input[data-automation-id="phone-number"]']),
        ("city", ['input[data-automation-id="addressSection_city"]']),
    ]

    filled = []
    for answer_key, selectors in fields:
        answer = get_answer(PORTAL, answer_key)
        if not answer:
            continue
        for selector in selectors:
            if fill_input_field(page, selector, answer):
                filled.append(answer_key)
                human_delay(0.5, 1.2)
                break

    return filled


def _upload_resume(page: Page, resume_path: str, job_id: str, dry_run: bool) -> bool:
    """Upload resume on Workday. Returns True if uploaded."""
    if not Path(resume_path).exists():
        return False

    try:
        file_input = page.query_selector(
            'input[type="file"][data-automation-id="file-upload-input-ref"], '
            'input[type="file"]'
        )
        if file_input:
            file_input.set_input_files(resume_path)
            console.print("    [green]Resume uploaded[/green]")
            log_action(job_id, PORTAL, "resume_uploaded", {"path": resume_path}, dry_run)
            human_delay(2, 4)  # Workday processes uploads slowly
            return True
    except Exception as e:
        console.print(f"    [yellow]Resume upload failed: {e}[/yellow]")
    return False


def _try_continue_without_account(page: Page) -> None:
    """Try to skip account creation on Workday if possible."""
    skip_selectors = [
        'button[data-automation-id="useMyLastApplication"]',
        'a[data-automation-id="applyWithoutAccount"]',
        'button:has-text("Apply Without Account")',
        'button:has-text("Continue Without Account")',
        'a:has-text("Apply as Guest")',
    ]
    for selector in skip_selectors:
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click()
                human_delay(2, 3)
                return
        except Exception:
            continue


def _handle_custom_questions(page: Page, job_id: str, dry_run: bool) -> None:
    """Attempt to answer custom Workday questions on the current step."""
    labels = page.query_selector_all("label[data-automation-id]")

    answered = 0
    unknown = 0

    for label in labels:
        try:
            label_text = label.inner_text().strip()
            if not label_text or len(label_text) < 3:
                continue

            parent = label.evaluate_handle("el => el.parentElement")
            input_el = parent.as_element().query_selector(
                "input:not([type='file']):not([type='hidden']), textarea, select"
            )
            if not input_el or not input_el.is_visible():
                continue

            answer = get_answer(PORTAL, label_text)
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

                human_delay(0.5, 1.0)
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
