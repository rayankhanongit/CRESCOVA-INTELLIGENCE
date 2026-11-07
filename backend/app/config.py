"""Environment-based configuration. Secrets only ever come from the environment or backend/.env."""
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

DEFAULT_CATEGORY_WEIGHTS = {
    "technical": 25,
    "onpage": 25,
    "content": 20,
    "indexability": 15,
    "linking": 10,
    "structured": 5,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    environment: str = "development"
    database_url: str = f"sqlite:///{(BASE_DIR / 'crescova.db').as_posix()}"
    secret_key: str = ""
    session_hours: int = 12
    cookie_secure: bool = False
    allow_registration: bool = True
    cors_origins: str = "http://localhost:5173"

    # SEO engine
    seo_category_weights: dict[str, float] = DEFAULT_CATEGORY_WEIGHTS
    crawl_max_pages_limit: int = 200
    crawl_max_depth_limit: int = 6
    crawl_delay_seconds: float = 0.5
    crawl_user_agent: str = "CrescovaBot/1.0 (SEO audit; honours robots.txt)"
    max_concurrent_audits_per_org: int = 2

    # AI providers (Phase C). Keys are read from the environment only and never sent to the frontend.
    ai_provider: str = "none"
    gemini_api_key: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def resolved_secret(self) -> str:
        if self.secret_key:
            return self.secret_key
        if self.environment == "production":
            raise RuntimeError("SECRET_KEY must be set when ENVIRONMENT=production")
        # Development convenience: generate once and keep in a git-ignored file.
        path = BASE_DIR / ".secret_key"
        if not path.exists():
            path.write_text(secrets.token_urlsafe(48))
        return path.read_text().strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
