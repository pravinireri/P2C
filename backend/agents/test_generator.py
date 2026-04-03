"""
Test Generator Agent - Generates xUnit test cases that validate PB behavioral fidelity.

Tests verify not just that the C# code compiles, but that it reproduces
the exact behavior of the original PowerBuilder application: same messages,
same error paths, same transaction boundaries, same row-level handling.
"""

from __future__ import annotations

import json
import re

from .base import BaseAgent
from ..services.llm_service import LLMService, UsageStats


class TestGeneratorAgent(BaseAgent):
    """Agent for generating comprehensive xUnit test cases that validate PB fidelity."""

    def __init__(self, llm_service: LLMService) -> None:
        super().__init__(llm_service)

    @property
    def system_prompt(self) -> str:
        return """\
You are a senior QA engineer specialising in .NET 8 applications migrated from PowerBuilder.
Your tests must verify that the C# code behaves IDENTICALLY to the original PB application.

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

═══════════════════════════════════════════
 PB-SPECIFIC TEST CATEGORIES (MANDATORY)
═══════════════════════════════════════════

A. DataWindow Adapter Tests:
   - Mock IDataWindowAdapter<T>
   - Test GetItem returns correct values for valid rows
   - Test GetItem with null/empty values (PB's IsNull + Len=0 handling)
   - Test that Update() is called (not direct DB writes)
   - Test row count = 0 edge case (no rows in DataWindow)
   - Test current row behavior

B. SQLCA Error Path Tests:
   - Success path (PB SQLCode = 0): verify correct message shown
   - Not-found path (PB SQLCode = 100): verify "not found" behavior
   - Error path (PB SQLCode = -1): verify error message with SQLErrText equivalent
   - Return value preservation: if PB returned -1 on error, assert C# returns -1

C. INotificationService Message Tests:
   - Mock INotificationService
   - Verify ShowInfoAsync called with EXACT message strings from PB
   - Verify ShowErrorAsync called for error conditions
   - Verify messages are NOT shown when PB wouldn't show them
   - Verify conditional messages match PB's conditions

D. Transaction Tests:
   - Verify CommitAsync called on success path
   - Verify RollbackAsync called on failure path
   - Verify no commit on partial failure (if PB rolled back all)
   - Mock IDbConnection and IDbTransaction

E. Edge Case Tests:
   - Null input values
   - Empty string values
   - No rows selected
   - Multiple rows with mixed update results
   - Invalid/missing data scenarios

Standard test requirements:
5. Cover: happy path, null inputs, boundary values, expected exceptions
6. Include [Fact] for single cases, [Theory] + [InlineData] for parameterised
7. Add // Arrange / // Act / // Assert comments in each test
8. Wrap the class in namespace `LegacyMigrated.Tests`
9. In notes: list what is covered, what is NOT covered, and suggested integration tests
10. Add a comment in each test explaining which PB behavior it validates"""

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
            f"The code was migrated from PowerBuilder — test that it preserves "
            f"the original PB behavior exactly. Return your response as JSON.\n\n"
            f"```{language}\n{code}\n```"
        )
        raw, usage = await self.llm.complete_with_usage(
            self.system_prompt, user_prompt, temperature=0.2
        )
        return self._parse(raw), usage
