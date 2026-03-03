from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    DATABASE_URL: str = "postgresql+asyncpg://espuser:esppass@timescaledb:5432/espdb"
    REDIS_URL: str = "redis://redis:6379/0"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB


settings = Settings()
