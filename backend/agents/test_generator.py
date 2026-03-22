"""
Test Generator Agent - Generates xUnit test cases for translated C# code.
Extended with generate_with_usage() to return token consumption data.
"""

from __future__ import annotations

import json
import re

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats


class TestGeneratorAgent(BaseAgent):
    """Agent for generating comprehensive xUnit test cases."""

    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
You are a senior QA engineer specialising in .NET 8 applications.
Given translated C# code, generate comprehensive unit tests.

Respond ONLY with valid JSON — no extra text — using this schema:
{
    "test_code": "<complete compilable C# test class>",
    "notes": "<markdown string describing coverage and any gaps>"
}

Test requirements:
1. Framework: xUnit (Fact / Theory attributes)
2. Assertions: FluentAssertions (result.Should().Be(...))
3. Mocking: Moq for interfaces/external dependencies
4. Naming: MethodName_Scenario_ExpectedResult convention
5. Cover: happy path, null inputs, boundary values, expected exceptions
6. Include [Fact] for single cases, [Theory] + [InlineData] for parameterised
7. Add // Arrange / // Act / // Assert comments in each test
8. Wrap the class in namespace `LegacyMigrated.Tests`
9. In notes: list what is covered, what is NOT covered, and suggested integration tests"""

    def _parse(self, raw: str) -> dict:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            code_match = re.search(r"```(?:\w+)?\n(.*?)```", raw, re.DOTALL)
            test_code = code_match.group(1) if code_match else raw
            return {
                "test_code": test_code.strip(),
                "notes": "Test cases generated. Review and adjust as needed.",
            }

    async def generate(self, code: str, language: str) -> dict:
        """Generate tests; return result dict."""
        result, _ = await self.generate_with_usage(code, language)
        return result

    async def generate_with_usage(self, code: str, language: str) -> tuple[dict, UsageStats]:
        """Generate tests; return (result_dict, UsageStats)."""
        user_prompt = (
            f"Generate comprehensive xUnit tests for this {language} code. "
            f"Return your response as JSON.\n\n"
            f"```{language}\n{code}\n```"
        )
        raw, usage = await self.llm.complete_with_usage(
            self.system_prompt, user_prompt, temperature=0.2
        )
        return self._parse(raw), usage
