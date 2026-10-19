"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings with environment variable support."""

    database_url: str = "sqlite+aiosqlite:///./formrelay.db"
    secret_key: str = "change-me-to-a-random-secret-key"
    cors_origins: str = "http://localhost:5173"
    api_prefix: str = "/api"
    debug: bool = False

    # Request limits
    max_request_body_bytes: int = 1_048_576  # 1 MB

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


settings = Settings()
