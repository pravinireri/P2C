"""
Translator Agent - Translates legacy code to modern languages.
Extended with translate_with_usage() to return token consumption data.
"""

from __future__ import annotations

import json
import re

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats
from ..utils.prompts import get_language_context


class TranslatorAgent(BaseAgent):
    """Agent for translating legacy code to modern languages."""

    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
You are a senior software engineer specializing in migrating enterprise legacy applications
to modern .NET 8 C#. You have deep expertise in PowerBuilder, COBOL, and VB6.

Respond ONLY with valid JSON — no extra text — using this schema:
{
    "translated_code": "<complete compilable C# code>",
    "notes": "<markdown string with migration notes>"
}

Translation rules:
1. Target .NET 8 C# with modern idioms (records, pattern matching, LINQ, async/await)
2. Preserve ALL business logic — never simplify, omit, or assume business rules
3. Add XML doc comments (///) to every public type and member
4. Replace DataWindow → Entity Framework Core DbSet with a clear TODO comment
5. Replace SQLCA/Embedded SQL → IDbConnection with parameterised queries
6. Replace messagebox() → INotificationService calls for the PowerPlan UI layer:
   - Constructor-inject: private readonly INotificationService _notificationService;
   - Info messages: await _notificationService.ShowInfoAsync("message");
   - Error messages: await _notificationService.ShowErrorAsync("message");
   - DO NOT use Console.WriteLine or MessageBox.Show
7. Use nullable reference types (?) appropriately
8. Namespace: use `LegacyMigrated.<ModuleName>` convention
9. In the notes field, list: (a) assumptions made, (b) TODOs needing human review,
   (c) any external dependencies that need wiring up
10. Note which PowerBuilder constructs were mapped to which C# equivalents (e.g.,
    DataWindow → EF Core DbSet, MessageBox → INotificationService, SQLCA → IDbConnection)"""

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
        """Translate code; return result dict."""
        result, _ = await self.translate_with_usage(code, source_language, target_language)
        return result

    async def translate_with_usage(
        self, code: str, source_language: str, target_language: str
    ) -> tuple[dict, UsageStats]:
        """Translate code; return (result_dict, UsageStats)."""
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
