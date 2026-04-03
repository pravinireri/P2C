import asyncio
from fastapi import APIRouter, HTTPException
from models.schemas import ModernizeRequest, ModernizeResponse, AnalysisResult
from agents import analyzer, translator, test_generator

router = APIRouter()


@router.post("/modernize", response_model=ModernizeResponse, summary="Modernize legacy code")
async def modernize_code(request: ModernizeRequest):
    try:
        analysis_task = analyzer.analyze(request.legacy_code, request.source_language)
        translation_task = translator.translate(request.legacy_code, request.source_language)

        analysis_result, translated_code = await asyncio.gather(
            analysis_task, translation_task
        )

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
