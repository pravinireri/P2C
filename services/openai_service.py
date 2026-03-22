"""
OpenAI service — single responsibility: communicate with the OpenAI Chat API.
All agents depend on this service; swap the underlying model here without
touching any agent logic.
"""

from openai import AsyncOpenAI
from config import settings

_client = AsyncOpenAI(api_key=settings.openai_api_key)


async def chat_completion(system_prompt: str, user_prompt: str) -> str:
    """
    Send a chat completion request and return the assistant's text response.

    Args:
        system_prompt: Role / instructions for the LLM.
        user_prompt:   The actual task / code to process.

    Returns:
        The raw text content of the first choice.
    """
    response = await _client.chat.completions.create(
        model=settings.openai_model,
        max_tokens=settings.max_tokens,
        temperature=settings.temperature,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.choices[0].message.content.strip()
