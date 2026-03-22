"""
Test Generator Agent — generates NUnit/xUnit test cases for the translated C# code.
"""

from services.openai_service import chat_completion

SYSTEM_PROMPT = """\
You are a senior QA engineer specializing in .NET applications.

Given translated C# code, generate a comprehensive set of unit tests using xUnit.
Requirements:
1. Use xUnit as the testing framework.
2. Use FluentAssertions for assertions (e.g., result.Should().Be(...)).
3. Mock external dependencies (databases, HTTP clients) with Moq.
4. Cover: happy path, edge cases, and expected exceptions.
5. Each test method must follow the naming convention: MethodName_Scenario_ExpectedResult.
6. Return ONLY the C# test class code — no markdown, no explanation.
"""


async def generate_tests(translated_code: str) -> str:
    """
    Generate xUnit test cases for the given translated C# code.
    """
    user_prompt = (
        "Generate xUnit tests for the following C# code:\n\n"
        f"{translated_code}"
    )
    return await chat_completion(SYSTEM_PROMPT, user_prompt)
