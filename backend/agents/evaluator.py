"""
Evaluator Agent — the self-evaluating step of the pipeline.

Scores the translation for faithfulness to the original business logic
and idiomaticity of the generated C# code. This is what separates a
production migration pipeline from a simple prompt chain.
"""

from __future__ import annotations

import json
import re

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats


class EvaluatorAgent(BaseAgent):
    """
    LLM-as-judge: evaluates a code translation against the original source.

    Returns structured scores so the UI can render confidence meters.
    """

    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
You are a rigorous senior code reviewer with deep expertise in both PowerBuilder and C#.
Your job is to evaluate whether a C# translation faithfully and idiomatically represents
the original PowerBuilder source code.

Respond ONLY with valid JSON — no markdown, no extra text — using this exact schema:
{
    "faithfulness_score": <integer 0-100>,
    "idiomaticity_score": <integer 0-100>,
    "risk_level": "Low" | "Medium" | "High",
    "strengths": ["<observation>", ...],
    "issues": ["<issue>", ...],
    "reviewer_note": "<one concise paragraph summarising the overall quality>"
}

Scoring guidance:
- faithfulness_score: Are ALL business rules, data transformations, and side effects correctly captured?
  90-100 = perfect preservation; 70-89 = minor omissions; <70 = logic gaps present
  Key checks for PowerBuilder: DataWindow operations (GetItemString, Retrieve, Update),
  null/empty checks (IsNull), MessageBox calls preserved as INotificationService
- idiomaticity_score: Does the C# feel like it was written by a senior .NET engineer?
  90-100 = idiomatic .NET 8; 70-89 = functional but not idiomatic; <70 = direct transliteration
  Key checks: Uses async/await, DI (INotificationService, IDbConnection), LINQ, nullable refs
- risk_level: Overall deployment risk considering both scores and code complexity
  Low = safe to deploy with minimal review
  Medium = needs manual review of specific areas (flag which ones)
  High = logic gaps or missing error handling detected"""

    async def evaluate(
        self,
        original_code: str,
        translated_code: str,
        source_language: str = "PowerBuilder",
    ) -> tuple[dict, UsageStats]:
        """
        Evaluate the quality of a code translation.

        Args:
            original_code:   The original legacy source.
            translated_code: The LLM-generated C# output.
            source_language: Label for the source language.

        Returns:
            (evaluation_dict, UsageStats)
        """
        user_prompt = (
            f"## Original {source_language} Code\n```\n{original_code}\n```\n\n"
            f"## Translated C# Code\n```csharp\n{translated_code}\n```\n\n"
            "Evaluate the translation quality and return your assessment as JSON."
        )

        raw, usage = await self.llm.complete_with_usage(
            self.system_prompt, user_prompt, temperature=0.1
        )

        try:
            return json.loads(raw), usage
        except json.JSONDecodeError:
            # Graceful fallback: extract JSON from markdown fences if present
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group()), usage
                except json.JSONDecodeError:
                    pass

        # Hard fallback — surface the raw text as a reviewer note
        return {
            "faithfulness_score": 0,
            "idiomaticity_score": 0,
            "risk_level": "High",
            "strengths": [],
            "issues": ["Evaluator could not parse a structured response."],
            "reviewer_note": raw,
        }, usage
