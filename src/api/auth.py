"""API authentication — simple bearer token for localhost security.

Generates a random API token on first use, stored in config/api_token.
All /api/ endpoints (except /api/health) require this token.
The React UI reads the token from the same file via the settings endpoint.
"""

import secrets

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from src.paths import CONFIG_DIR

TOKEN_PATH = CONFIG_DIR / "api_token"


def get_or_create_token() -> str:
    """Get existing API token or generate a new one."""
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TOKEN_PATH.exists():
        token = TOKEN_PATH.read_text().strip()
        if token:
            return token
    token = secrets.token_urlsafe(32)
    TOKEN_PATH.write_text(token)
    return token


class APITokenMiddleware(BaseHTTPMiddleware):
    """Require Bearer token for all /api/ endpoints except health and token retrieval."""

    # Endpoints that don't need auth
    PUBLIC_PATHS = {"/api/health", "/api/auth/token"}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth for non-API routes (static files, SPA)
        if not path.startswith("/api/"):
            return await call_next(request)

        # Skip auth for public endpoints
        if path in self.PUBLIC_PATHS:
            return await call_next(request)

        # Check bearer token
        expected = get_or_create_token()
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing Authorization header")

        provided = auth_header[7:]  # Strip "Bearer "
        if provided != expected:
            raise HTTPException(status_code=401, detail="Invalid API token")

        return await call_next(request)
