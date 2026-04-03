from __future__ import annotations

import json
import re

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats
from ..utils.prompts import get_language_context


class TranslatorAgent(BaseAgent):
    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
Translate legacy code to modern C#.

Return only valid JSON with this shape:
{
  "translated_code": "<complete C# code>",
  "notes": "<short migration notes>"
}

Keep behavior aligned with the source code:
- preserve business rules, conditions, return values, and side effects
- preserve user-visible messages and when they appear
- keep transaction behavior equivalent
- keep SQL/error paths equivalent

For PowerBuilder code, map DataWindow usage through an adapter-style abstraction,
not direct table access from event logic.

Write clear compilable .NET 8 code with async/await for I/O and dependency injection.
Use parameterized SQL and keep output concise."""

    def _parse(self, raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            code_match = re.search(r"```(?:\w+)?\n(.*?)```", raw, re.DOTALL)
            translated = code_match.group(1) if code_match else raw
            return {
                "translated_code": translated.strip(),
                "notes": "Translation completed. Please review for accuracy.",
            }

    async def translate(
        self, code: str, source_language: str, target_language: str
    ) -> dict:
        result, _ = await self.translate_with_usage(code, source_language, target_language)
        return result

    async def translate_with_usage(
        self, code: str, source_language: str, target_language: str
    ) -> tuple[dict, UsageStats]:
        user_prompt = (
            f"Translate this {source_language} code to {target_language}. "
            f"Return your response as JSON.\n\n"
            f"{get_language_context(source_language)}\n\n"
            f"```{source_language}\n{code}\n```"
        )
        raw, usage = await self.llm.complete_with_usage(
            self.system_prompt, user_prompt, temperature=0.2
        )
        return self._parse(raw), usage
