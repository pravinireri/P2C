"""
Modernize router — orchestrates the three agents (analyze → translate → test).
"""

import asyncio
from fastapi import APIRouter, HTTPException
from models.schemas import ModernizeRequest, ModernizeResponse, AnalysisResult
from agents import analyzer, translator, test_generator

router = APIRouter()


@router.post("/modernize", response_model=ModernizeResponse, summary="Modernize legacy code")
async def modernize_code(request: ModernizeRequest):
    """
    Pipeline:
    1. Analyze the legacy code (structure, complexity, issues).
    2. Translate it to C#.
    3. Optionally generate xUnit tests for the translated code.
    """
    try:
        # Steps 1 and 2 run concurrently — analysis doesn't depend on translation
        analysis_task = analyzer.analyze(request.legacy_code, request.source_language)
        translation_task = translator.translate(request.legacy_code, request.source_language)

        analysis_result, translated_code = await asyncio.gather(
            analysis_task, translation_task
        )

        # Step 3 is conditional and depends on the translated code
        test_cases = None
        if request.include_tests:
            test_cases = await test_generator.generate_tests(translated_code)

        return ModernizeResponse(
            analysis=analysis_result,
            translated_code=translated_code,
            test_cases=test_cases,
            source_language=request.source_language,
        )

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
