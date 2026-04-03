import json
from services.openai_service import chat_completion
from models.schemas import AnalysisResult

SYSTEM_PROMPT = """\
You are an expert software analyst specializing in legacy PowerBuilder applications.
Your job is to analyze a code snippet and return a structured JSON object with these fields:
- summary: A 2-3 sentence plain-English description of what the code does.
- complexity: One of "Low", "Medium", or "High" based on code size and logic depth.
- key_constructs: A list of important language constructs or patterns used (e.g., DataWindow, Embedded SQL).
- potential_issues: A list of known migration challenges or anti-patterns in this code.

Return ONLY valid JSON. No markdown, no explanation.
"""


async def analyze(legacy_code: str, source_language: str = "PowerBuilder") -> AnalysisResult:
    user_prompt = (
        f"Source language: {source_language}\n\n"
        f"Code:\n```\n{legacy_code}\n```"
    )

    raw = await chat_completion(SYSTEM_PROMPT, user_prompt)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(match.group()) if match else {}

    return AnalysisResult(
        summary=data.get("summary", "Unable to summarize."),
        complexity=data.get("complexity", "Unknown"),
        key_constructs=data.get("key_constructs", []),
        potential_issues=data.get("potential_issues", []),
    )
