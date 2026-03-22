"""
General-purpose code utilities.
"""

import re


def strip_markdown_fences(text: str) -> str:
    """
    Remove leading/trailing markdown code fences (```lang ... ```)
    that an LLM may accidentally include in a response.
    """
    pattern = r"^```[a-zA-Z]*\n?(.*?)```$"
    match = re.match(pattern, text.strip(), re.DOTALL)
    return match.group(1).strip() if match else text.strip()


def truncate_code(code: str, max_chars: int = 12000) -> str:
    """
    Truncate very large code snippets to avoid exceeding context limits.
    Adds a comment at the end indicating truncation.
    """
    if len(code) <= max_chars:
        return code
    return code[:max_chars] + "\n// ... [truncated for context limit]"


def estimate_token_count(text: str) -> int:
    """
    Rough estimate: 1 token ≈ 4 characters.
    Useful for pre-flight checks before sending to the API.
    """
    return len(text) // 4
