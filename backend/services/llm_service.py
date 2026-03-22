"""
LLM Service - Handles all OpenAI API interactions.
Tracks token usage and estimated cost per call.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Final

from openai import AsyncOpenAI

DEFAULT_MODEL: Final[str] = "gpt-4o-mini"

# Pricing per 1 000 tokens (USD) — update when OpenAI changes rates
COST_PER_1K: dict[str, dict[str, float]] = {
    "gpt-4o": {"input": 0.005, "output": 0.015},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4-turbo": {"input": 0.010, "output": 0.030},
}


@dataclass
class UsageStats:
    """Token usage and estimated cost for a single LLM call."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0

    def __add__(self, other: UsageStats) -> UsageStats:
        """Aggregate usage stats across multiple calls."""
        return UsageStats(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            estimated_cost_usd=round(self.estimated_cost_usd + other.estimated_cost_usd, 6),
        )


class LLMService:
    """Service for interacting with the OpenAI Chat API."""

    def __init__(self) -> None:
        api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in backend/.env")

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = (os.getenv("OPENAI_MODEL") or "gpt-4o-mini").strip()

    def _estimate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        rates = COST_PER_1K.get(self.model, {"input": 0.005, "output": 0.015})
        return round(
            (prompt_tokens / 1000) * rates["input"]
            + (completion_tokens / 1000) * rates["output"],
            6,
        )

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
    ) -> str:
        """Send a completion request and return the text response."""
        text, _ = await self.complete_with_usage(system_prompt, user_prompt, temperature)
        return text

    async def complete_with_usage(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
    ) -> tuple[str, UsageStats]:
        """
        Send a completion request and return (text, UsageStats).
        All agents should call this to surface cost data.
        """
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )

        text = response.choices[0].message.content or ""
        usage = response.usage

        stats = UsageStats(
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            estimated_cost_usd=self._estimate_cost(
                usage.prompt_tokens if usage else 0,
                usage.completion_tokens if usage else 0,
            ),
        )
        return text, stats
