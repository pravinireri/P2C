from __future__ import annotations

import json

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats
from ..utils.prompts import get_language_context


class AnalyzerAgent(BaseAgent):
    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
You are an expert legacy code analyst specializing in PowerBuilder, COBOL, VB6, and
other enterprise legacy languages. Your job is to analyze code and provide clear,
actionable explanations that help migration engineers understand what they are dealing with.

Respond ONLY with valid JSON — no markdown fences, no extra text — using this schema:
{
    "explanation": "<2-4 sentence plain-English description of what the code does>",
    "complexity": "low" | "medium" | "high",
    "key_components": ["<component1>", "<component2>", ...]
}

In your explanation, focus on:
- Business purpose (what problem does this code solve?)
- Data flow and transformations
- External dependencies (DB, UI, external systems)
- Any obvious anti-patterns or technical debt

For PowerBuilder code, additionally identify:
- DataWindow operations (GetItemString, Retrieve, Update, InsertRow, DeleteRow)
  and their impact on migration (need DataWindow adapter, not raw DB calls)
- SQLCA error handling patterns (SQLCode checks: 0, 100, -1)
- MessageBox calls and the conditions under which they fire
- Transaction boundaries (COMMIT/ROLLBACK USING SQLCA)
- Row-level operations and current-row dependencies (GetRow)
- Null/empty handling patterns (IsNull, Len, IsValid)
- PFC service usage if present

In key_components, list specific PB constructs found, e.g.:
  "DataWindow: dw_employees (GetItemString, GetRow)",
  "SQLCA: error handling with SQLCode branching",
  "Transaction: COMMIT/ROLLBACK after Update()",
  "MessageBox: 3 user-facing messages (2 error, 1 info)" """

    def _parse(self, raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            import re
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return {
                "explanation": raw,
                "complexity": "unknown",
                "key_components": [],
            }

    async def analyze(self, code: str, language: str) -> dict:
        result, _ = await self.analyze_with_usage(code, language)
        return result

    async def analyze_with_usage(self, code: str, language: str) -> tuple[dict, UsageStats]:
        user_prompt = (
            f"Analyze this {language} code and provide your analysis as JSON:\n\n"
            f"{get_language_context(language)}\n\n"
            f"```{language}\n{code}\n```"
        )
        raw, usage = await self.llm.complete_with_usage(self.system_prompt, user_prompt)
        return self._parse(raw), usage
