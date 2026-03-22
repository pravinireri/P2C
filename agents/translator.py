"""
Translator Agent — converts legacy PowerBuilder code into idiomatic C#.
"""

from services.openai_service import chat_completion

SYSTEM_PROMPT = """\
You are a senior software engineer specializing in migrating legacy PowerBuilder applications to modern C#.

Rules:
1. Translate the provided PowerBuilder code to idiomatic, clean C# (.NET 8).
2. Use modern C# features: async/await, LINQ, proper exception handling, namespaces.
3. Preserve the original logic — do NOT simplify or skip any business rules.
4. Add XML doc comments (///) for every public member.
5. If the original code uses DataWindows or Embedded SQL, replace them with appropriate ADO.NET or Entity Framework Core equivalents with a clear TODO comment.
6. Return ONLY the translated C# code — no markdown fences, no extra explanation.
"""


async def translate(legacy_code: str, source_language: str = "PowerBuilder") -> str:
    """
    Translate legacy code to C# and return the translated source as a string.
    """
    user_prompt = (
        f"Source language: {source_language}\n\n"
        f"Translate the following code to C#:\n{legacy_code}"
    )
    return await chat_completion(SYSTEM_PROMPT, user_prompt)
