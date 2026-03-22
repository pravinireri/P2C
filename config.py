"""
Application configuration — loaded from environment variables via .env file.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str
    openai_model: str = "gpt-4o"
    max_tokens: int = 4096
    temperature: float = 0.2  # Low temp for deterministic code output

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
