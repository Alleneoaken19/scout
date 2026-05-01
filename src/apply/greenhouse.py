"""Greenhouse ATS apply bot — fills application forms on boards.greenhouse.io."""

import time
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout
from rich.console import Console

from src.apply.answers_store import get_answer, record_unknown_question
from src.apply.apply_logger import log_action
from src.apply.base_bot import fill_input_field, human_delay

console = Console()
PORTAL = "greenhouse"


def _wait_for_greenhouse_iframe(page: Page, timeout: int = 20):
    """Wait for a Greenhouse iframe to appear and return the frame."""
    for _ in range(timeout):
        for frame in page.frames:
            if "greenhouse.io" in frame.url and "embed/job_app" in frame.url:
                return frame
        time.sleep(1)
    return None


def _wait_for_form_field(form_page, selector: str, timeout: int = 15) -> bool:
    """Wait for a form field to appear."""
    for _ in range(timeout):
        try:
            el = form_page.query_selector(selector)
            if el and el.is_visible():
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def apply_greenhouse(
    page: Page,
    url: str,
    job_id: str,
    resume_path: str | None,
    cover_letter: str | None,
    dry_run: bool = True,
) -> bool:
    """Fill and optionally submit a Greenhouse application form."""
    console.print("    [cyan]Opening Greenhouse form...[/cyan]")

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except PlaywrightTimeout:
        console.print("    [red]Page load timed out[/red]")
        log_action(job_id, PORTAL, "timeout", {"url": url}, dry_run)
        return False

    human_delay(3, 5)

    # Resolve the form page (direct or embedded iframe)
    form_page = _resolve_form_page(page, url)

    # Wait for the form fields to render
    console.print("    [dim]Waiting for form fields...[/dim]")
    has_fields = _wait_for_form_field(form_page, "#first_name, input[name*='first_name']", timeout=15)
    if not has_fields:
        console.print("    [yellow]Form fields not detected — attempting anyway[/yellow]")

    log_action(job_id, PORTAL, "opened_form", {"url": url, "iframe": form_page is not page}, dry_run)

    # --- Fill personal info ---
    filled_fields = _fill_personal_info(form_page)
    console.print(f"    [dim]Filled {len(filled_fields)} fields: {', '.join(filled_fields)}[/dim]")
    log_action(job_id, PORTAL, "filled_fields", {"fields": filled_fields}, dry_run)

    # --- Resume upload ---
    if resume_path:
        _upload_resume(form_page, resume_path, job_id, dry_run)
    else:
        console.print("    [yellow]No resume to upload[/yellow]")

    # --- Cover letter (targeted selectors only, NOT bare "textarea") ---
    if cover_letter:
        _fill_cover_letter(form_page, cover_letter, job_id, dry_run)

    # --- Custom questions ---
    _handle_custom_questions(form_page, job_id, dry_run)

    # --- Submit or stop ---
    if dry_run:
        console.print("    [yellow]DRY RUN — form filled, NOT submitting[/yellow]")
        log_action(job_id, PORTAL, "dry_run_complete", {}, dry_run)
        return True

    return _submit_form(form_page, job_id, dry_run)


def _resolve_form_page(page: Page, url: str):
    """Find the actual form page — direct Greenhouse page or embedded iframe."""
    if "greenhouse.io" in url.lower():
        return page

    console.print("    [dim]Looking for embedded Greenhouse iframe...[/dim]")
    gh_frame = _wait_for_greenhouse_iframe(page, timeout=15)
    if gh_frame:
        console.print("    [green]Found embedded Greenhouse form[/green]")
        return gh_frame

    # Try clicking an "Apply" button first
    for selector in ['a:has-text("Apply")', 'button:has-text("Apply")']:
        try:
            btn = page.query_selector(selector)
            if btn and btn.is_visible():
                btn.click(timeout=5000)
                human_delay(3, 5)
                gh_frame = _wait_for_greenhouse_iframe(page, timeout=15)
                if gh_frame:
                    console.print("    [green]Found form after clicking Apply[/green]")
                    return gh_frame
        except Exception:
            continue

    console.print("    [yellow]No iframe found — using direct page[/yellow]")
    return page


def _fill_personal_info(form_page) -> list[str]:
    """Fill standard personal info fields. Returns list of filled field names."""
    # Use ordered list to avoid duplicate filling — stop after first match per field
    fields = [
        ("first_name", ["#first_name", 'input[name="job_application[first_name]"]']),
        ("last_name", ["#last_name", 'input[name="job_application[last_name]"]']),
        ("email", ["#email", 'input[name="job_application[email]"]']),
        ("phone", ["#phone", 'input[name="job_application[phone]"]']),
        ("location", ['input[name="job_application[location]"]']),
        ("linkedin_profile", ['input[autocomplete="url"]', "#job_application_linkedin_profile_url"]),
        ("github_profile", ["#job_application_website_url"]),
    ]

    filled = []
    for answer_key, selectors in fields:
        answer = get_answer(PORTAL, answer_key)
        if not answer:
            continue
        for selector in selectors:
            if fill_input_field(form_page, selector, answer):
                filled.append(answer_key)
                human_delay(0.5, 1.0)
                break  # Don't try other selectors for same field

    return filled


def _upload_resume(form_page, resume_path: str, job_id: str, dry_run: bool) -> bool:
    """Upload resume file. Returns True if successful."""
    if not Path(resume_path).exists():
        console.print(f"    [yellow]Resume file not found: {resume_path}[/yellow]")
        return False

    try:
        file_input = form_page.query_selector('input[type="file"]')
        if not file_input:
            console.print("    [yellow]No file input found for resume[/yellow]")
            return False

        file_input.set_input_files(resume_path)
        human_delay(2, 3)

        # Verify upload — check if a filename label appeared
        upload_label = form_page.query_selector(".filename, .file-name, [class*='upload'] span")
        if upload_label:
            console.print(f"    [green]Resume uploaded: {upload_label.inner_text().strip()[:40]}[/green]")
        else:
            console.print("    [green]Resume uploaded[/green]")

        log_action(job_id, PORTAL, "resume_uploaded", {"path": resume_path}, dry_run)
        return True
    except Exception as e:
        console.print(f"    [yellow]Resume upload failed: {e}[/yellow]")
        return False


def _fill_cover_letter(form_page, cover_letter: str, job_id: str, dry_run: bool) -> bool:
    """Fill cover letter into the correct field — NOT any random textarea."""
    # Only use selectors that specifically target cover letter fields
    cover_selectors = [
        "#cover_letter",
        "textarea[name*='cover_letter']",
        "textarea[name*='cover']",
        'textarea[aria-label*="cover letter" i]',
        'textarea[placeholder*="cover letter" i]',
    ]

    for selector in cover_selectors:
        try:
            field = form_page.query_selector(selector)
            if field and field.is_visible():
                field.fill(cover_letter)
                console.print("    [green]Cover letter filled[/green]")
                log_action(job_id, PORTAL, "cover_letter_filled", {}, dry_run)
                human_delay(0.5, 1.0)
                return True
        except Exception:
            continue

    console.print("    [dim]No cover letter field found[/dim]")
    return False


def _submit_form(form_page, job_id: str, dry_run: bool) -> bool:
    """Find and click the submit button, then verify it actually submitted."""
    submit_selectors = [
        '#submit_app',
        'input[type="submit"][value*="Submit"]',
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
    ]

    for selector in submit_selectors:
        try:
            btn = form_page.query_selector(selector)
            if btn and btn.is_visible():
                human_delay(1, 2)
                btn.click(timeout=10000)
                human_delay(3, 5)

                # Check for validation errors — if error messages appeared, form didn't submit
                error_els = form_page.query_selector_all(
                    '.field-error, .error-message, [class*="error"], '
                    '.field--error, .has-error, [aria-invalid="true"]'
                )
                visible_errors = [e for e in error_els if e.is_visible()]
                if visible_errors:
                    error_texts = []
                    for e in visible_errors[:5]:
                        try:
                            error_texts.append(e.inner_text().strip())
                        except Exception:
                            pass
                    console.print(f"    [red]Form has validation errors ({len(visible_errors)}):[/red]")
                    for et in error_texts:
                        if et:
                            console.print(f"      [red]- {et[:80]}[/red]")
                    log_action(job_id, PORTAL, "validation_errors",
                               {"errors": error_texts}, dry_run)
                    return False

                # Check for success indicators
                success_el = form_page.query_selector(
                    '#application_confirmation, .confirmation, '
                    '[class*="success"], [class*="thank"]'
                )
                if success_el:
                    console.print("    [green]Application submitted and confirmed![/green]")
                else:
                    console.print("    [green]Application submitted![/green]")

                log_action(job_id, PORTAL, "submitted", {}, dry_run)
                return True
        except PlaywrightTimeout:
            console.print("    [yellow]Submit click timed out — trying next selector[/yellow]")
            continue
        except Exception:
            continue

    console.print("    [yellow]Submit button not found[/yellow]")
    log_action(job_id, PORTAL, "submit_button_not_found", {}, dry_run)
    return False


def _handle_custom_questions(page, job_id: str, dry_run: bool) -> None:
    """Attempt to answer custom Greenhouse questions."""
    labels = page.query_selector_all("label")
    answered = 0
    unknown = 0

    # Track which inputs we've already handled to avoid double-filling
    handled_ids = {"first_name", "last_name", "email", "phone", "cover_letter"}

    for label in labels:
        try:
            label_text = label.inner_text().strip()
            if not label_text or len(label_text) < 3:
                continue

            for_attr = label.get_attribute("for")
            if not for_attr or for_attr in handled_ids:
                continue

            input_el = page.query_selector(f"#{for_attr}")
            if not input_el or not input_el.is_visible():
                continue

            tag = input_el.evaluate("el => el.tagName").lower()
            input_type = input_el.get_attribute("type") or ""

            if input_type in ("file", "hidden"):
                continue

            # Clean label text for matching (remove asterisks, extra whitespace)
            clean_label = label_text.replace("*", "").strip()

            answer = get_answer(PORTAL, clean_label)
            if answer:
                success = _fill_question(input_el, tag, input_type, answer, page, for_attr)
                if success:
                    handled_ids.add(for_attr)
                    human_delay(0.3, 0.7)
                    answered += 1
                    log_action(job_id, PORTAL, "answered_question",
                               {"question": clean_label, "answer": answer}, dry_run)
                else:
                    unknown += 1
                    console.print(f"    [yellow]Could not fill: {clean_label[:60]}[/yellow]")
            else:
                unknown += 1
                record_unknown_question(PORTAL, clean_label)
                log_action(job_id, PORTAL, "unknown_question",
                           {"question": clean_label}, dry_run)
        except Exception:
            continue

    if answered or unknown:
        console.print(f"    [dim]Custom questions: {answered} answered, {unknown} unknown[/dim]")


def _fill_question(input_el, tag: str, input_type: str, answer: str, page, for_attr: str) -> bool:
    """Fill a single form question. Returns True if successful."""
    try:
        if tag == "select":
            return _select_dropdown(input_el, answer)
        elif tag == "textarea":
            input_el.fill(answer)
            return True
        elif input_type in ("checkbox", "radio"):
            if answer.lower() in ("yes", "true", "1", "i agree"):
                input_el.check()
            else:
                input_el.uncheck()
            return True
        else:
            input_el.fill(answer)
            return True
    except Exception:
        return False


def _select_dropdown(select_el, answer: str) -> bool:
    """Try multiple strategies to select a dropdown option."""
    answer_lower = answer.lower().strip()

    # Strategy 1: Exact label match
    try:
        select_el.select_option(label=answer)
        return True
    except Exception:
        pass

    # Strategy 2: Exact value match
    try:
        select_el.select_option(value=answer)
        return True
    except Exception:
        pass

    # Strategy 3: Get all options and find partial match
    try:
        options = select_el.evaluate("""el => {
            return Array.from(el.options).map(o => ({
                value: o.value,
                text: o.textContent.trim(),
                label: o.label
            }));
        }""")

        for opt in options:
            opt_text = (opt.get("text") or "").lower().strip()
            opt_label = (opt.get("label") or "").lower().strip()
            opt_value = opt.get("value", "")

            # Skip empty/placeholder options
            if not opt_text or opt_text in ("select...", "select", "-- select --", "choose..."):
                continue

            # Partial match: answer contains option text or vice versa
            if (answer_lower in opt_text or opt_text in answer_lower or
                    answer_lower in opt_label or opt_label in answer_lower):
                select_el.select_option(value=opt_value)
                return True
    except Exception:
        pass

    return False
