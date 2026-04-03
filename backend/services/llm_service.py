"""
LLM Service - Handles all OpenAI API interactions.
Tracks token usage and estimated cost per call.

Uses the modern OpenAI Responses API (client.responses.create with input=).
"""

from __future__ import annotations

import os
import traceback
from dataclasses import dataclass
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
    """Service for interacting with the OpenAI Responses API."""

    def __init__(self) -> None:
        api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set in backend/.env")

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = (os.getenv("OPENAI_MODEL") or DEFAULT_MODEL).strip()

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
        Send a completion request via the Responses API and return (text, UsageStats).
        All agents should call this to surface cost data.
        """
        try:
            response = await self.client.responses.create(
                model=self.model,
                instructions=system_prompt,
                input=user_prompt,
                temperature=temperature,
            )
        except Exception as exc:
            # Print the REAL error to server logs so it's never masked
            print(f"[LLMService] OpenAI API call failed:\n{exc}")
            traceback.print_exc()
            raise

        # Responses API: output_text is the top-level text accessor
        text = response.output_text or ""

        # Responses API usage fields: input_tokens / output_tokens
        usage = response.usage
        input_tokens = usage.input_tokens if usage else 0
        output_tokens = usage.output_tokens if usage else 0

        stats = UsageStats(
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            estimated_cost_usd=self._estimate_cost(input_tokens, output_tokens),
        )
        return text, stats
