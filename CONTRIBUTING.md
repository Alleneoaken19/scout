# Contributing to Scout

Thanks for your interest in contributing to Scout! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/joelkanyi/scout.git
cd scout

# Create a virtual environment
python3.12 -m venv .venv
source .venv/bin/activate

# Install in development mode
pip install -e .

# Install Playwright browser
playwright install chromium

# Install frontend dependencies
cd ui && npm install && cd ..

# Run tests
pytest tests/ -v
```

## Running Locally

```bash
# Start in dev mode (API + Vite with hot-reload)
scout ui --dev

# Or run CLI commands directly
scout scrape
scout score --limit 5
scout doctor
```

## Project Structure

```
scout/
  cli.py              # CLI entry point (Typer)
  src/
    ai/               # AI providers + scoring + tailoring
    api/              # FastAPI REST endpoints
    apply/            # Browser automation (Playwright)
    resume/           # PDF/DOCX generation + ATS scoring
    scrapers/         # 13 job source scrapers
    tracking/         # Gmail integration
    integrations/     # Notion + Google Sheets
    domain.py         # Career domain detection
    database.py       # SQLAlchemy models
    preferences.py    # User preferences
    settings.py       # API keys + config
  ui/                 # React + Vite frontend
  data/
    domain_aliases/   # Skill aliases per career domain
  tests/              # pytest test suite
```

## Making Changes

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-change`
3. Make your changes
4. Run tests: `pytest tests/ -v`
5. Run the linter: `ruff check src/ cli.py`
6. Verify the frontend builds: `cd ui && npx tsc --noEmit && npm run build`
7. Commit and push
8. Open a Pull Request

## Adding a New Scraper

1. Create `src/scrapers/your_source.py`
2. Implement a function that returns `(new_count, skipped_count, filtered_count)`
3. Use `prefilter_job()` before inserting jobs
4. Use `insert_if_new()` for deduplication
5. Add to the scraper list in `cli.py` and `src/scheduler.py`
6. Wrap `resp.json()` in try/except

## Adding a New AI Provider

1. Create `src/ai/providers/your_provider.py`
2. Implement the `AIProvider` base class from `src/ai/providers/base.py`
3. Add the provider to `_get_provider()` in `src/ai/ai_client.py`
4. Add default model to `Settings.effective_model` in `src/settings.py`
5. Update the setup wizard in `cli.py`

## Adding a New Career Domain

1. Add domain keywords to `DOMAIN_KEYWORDS` in `src/domain.py`
2. Add skill categories, action verbs, and buzzwords to the same file
3. Create `data/domain_aliases/your_domain.json` with skill aliases
4. Add abbreviations to `_TITLE_ABBREVIATIONS` in `src/scrapers/prefilter.py`

## Code Style

- Python: Follow PEP 8. We use `ruff` for linting.
- TypeScript: Standard React patterns. We use `tsc` for type checking.
- No unnecessary abstractions. Keep it simple.
- Every scraper must handle API errors gracefully (try/except, log, continue).

## Reporting Issues

Open an issue at https://github.com/joelkanyi/scout/issues with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your OS and Python version (`scout doctor` output is helpful)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
