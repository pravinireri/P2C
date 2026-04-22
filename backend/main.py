from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import AsyncIterator

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env", override=True)

import fastapi
import fastapi.middleware.cors
from fastapi.responses import StreamingResponse

from .agents.analyzer import AnalyzerAgent
from .agents.translator import TranslatorAgent
from .agents.test_generator import TestGeneratorAgent
from .agents.evaluator import EvaluatorAgent
from .services.llm_service import LLMService, UsageStats as _UsageStats
from .models.schemas import (
    ModernizeRequest,
    ModernizeResponse,
    MigrateBatchRequest,
    MigrateBatchItemRequest,
    AnalyzeRequest,
    AnalyzeResponse,
    TranslateRequest,
    TranslateResponse,
    TestGenerateRequest,
    TestGenerateResponse,
    EvaluationResult,
    UsageStats,
)

app = fastapi.FastAPI(
    title="P2C API",
    description="AI-powered legacy code modernization pipeline with self-evaluation",
    version="2.0.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
allow_credentials = "*" not in allowed_origins

app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

llm_service = LLMService()
analyzer = AnalyzerAgent(llm_service)
translator = TranslatorAgent(llm_service)
test_generator = TestGeneratorAgent(llm_service)
evaluator = EvaluatorAgent(llm_service)

BATCH_RUNS: dict[str, list[MigrateBatchItemRequest]] = {}

def _aggregate_usage(*stats: _UsageStats) -> UsageStats:
    total = _UsageStats()
    for s in stats:
        total = total + s
    return UsageStats(
        prompt_tokens=total.prompt_tokens,
        completion_tokens=total.completion_tokens,
        total_tokens=total.total_tokens,
        estimated_cost_usd=total.estimated_cost_usd,
    )

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "2.0.0"}

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_code(request: AnalyzeRequest) -> AnalyzeResponse:
    result = await analyzer.analyze(request.code, request.language)
    return AnalyzeResponse(**result)


@app.post("/translate", response_model=TranslateResponse)
async def translate_code(request: TranslateRequest) -> TranslateResponse:
    result = await translator.translate(
        request.code, request.source_language, request.target_language
    )
    return TranslateResponse(**result)


@app.post("/generate-tests", response_model=TestGenerateResponse)
async def generate_tests(request: TestGenerateRequest) -> TestGenerateResponse:
    result = await test_generator.generate(request.code, request.language)
    return TestGenerateResponse(**result)

async def _modernize_core(request: ModernizeRequest) -> ModernizeResponse:
    (analysis, analysis_usage), (translation, translation_usage) = await asyncio.gather(
        analyzer.analyze_with_usage(request.code, request.source_language),
        translator.translate_with_usage(
            request.code, request.source_language, request.target_language
        ),
    )

    translated_code = translation["translated_code"]

    (eval_result, eval_usage), (tests, tests_usage) = await asyncio.gather(
        evaluator.evaluate(request.code, translated_code, request.source_language),
        test_generator.generate_with_usage(translated_code, request.target_language),
    )

    total_usage = _aggregate_usage(analysis_usage, translation_usage, eval_usage, tests_usage)

    return ModernizeResponse(
        original_code=request.code,
        analysis=analysis.get("explanation", ""),
        complexity=analysis.get("complexity", "unknown"),
        key_components=analysis.get("key_components", []),
        translated_code=translated_code,
        translation_notes=translation.get("notes", ""),
        test_cases=tests.get("test_code", ""),
        test_notes=tests.get("notes", ""),
        evaluation=EvaluationResult(**eval_result),
        usage=total_usage,
    )


def _openai_http_detail(exc: Exception) -> tuple[int, str]:
    import openai as _openai

    if isinstance(exc, _openai.RateLimitError):
        return (
            429,
            "OpenAI rate limit exceeded. Your account has hit its usage quota. "
            "Check https://platform.openai.com/usage or wait a moment and retry.",
        )
    if isinstance(exc, _openai.AuthenticationError):
        return (401, "Invalid OpenAI API key. Check OPENAI_API_KEY in backend/.env.")
    if isinstance(exc, _openai.APIError):
        return (502, f"OpenAI API error: {exc}")
    return (500, str(exc))


@app.post("/modernize", response_model=ModernizeResponse)
async def modernize_code(request: ModernizeRequest) -> ModernizeResponse:
    import openai as _openai

    try:
        return await _modernize_core(request)
    except _openai.RateLimitError as exc:
        status, detail = _openai_http_detail(exc)
        raise fastapi.HTTPException(status_code=status, detail=detail)
    except _openai.AuthenticationError as exc:
        status, detail = _openai_http_detail(exc)
        raise fastapi.HTTPException(status_code=status, detail=detail)
    except _openai.APIError as exc:
        status, detail = _openai_http_detail(exc)
        raise fastapi.HTTPException(status_code=status, detail=detail)
    except Exception as exc:
        raise fastapi.HTTPException(status_code=500, detail=str(exc))


@app.post("/migrate-batch")
async def migrate_batch(request: MigrateBatchRequest) -> dict[str, list[dict]]:
    """Run the same pipeline as /modernize for each item; failures become per-item errors."""
    import openai as _openai

    results: list[dict] = []
    for item in request.items:
        if not item.code.strip():
            results.append({"filename": item.filename, "error": "Empty code"})
            continue
        inner = ModernizeRequest(
            code=item.code,
            source_language=item.source_language,
            target_language=item.target_language,
        )
        try:
            resp = await _modernize_core(inner)
            row = resp.model_dump()
            row["filename"] = item.filename
            results.append(row)
        except _openai.RateLimitError as exc:
            status, detail = _openai_http_detail(exc)
            results.append({"filename": item.filename, "error": detail, "error_status": status})
        except _openai.AuthenticationError as exc:
            status, detail = _openai_http_detail(exc)
            results.append({"filename": item.filename, "error": detail, "error_status": status})
        except _openai.APIError as exc:
            status, detail = _openai_http_detail(exc)
            results.append({"filename": item.filename, "error": detail, "error_status": status})
        except Exception as exc:
            results.append({"filename": item.filename, "error": str(exc), "error_status": 500})

    return {"results": results}


@app.post("/migrate-batch/start")
async def migrate_batch_start(request: MigrateBatchRequest) -> dict[str, str | int]:
    run_id = str(uuid.uuid4())
    BATCH_RUNS[run_id] = list(request.items)
    return {"run_id": run_id, "file_count": len(request.items)}


async def _stream_single_modernize(request: ModernizeRequest) -> AsyncIterator[str]:
    """SSE stream for one file; ends with event `complete` carrying full ModernizeResponse JSON."""

    def _sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    yield _sse(
        "status",
        {"stage": "analyzing", "message": "Analyzing legacy code…", "progress": 12},
    )

    try:
        (analysis, analysis_usage), (translation, translation_usage) = await asyncio.gather(
            analyzer.analyze_with_usage(request.code, request.source_language),
            translator.translate_with_usage(
                request.code, request.source_language, request.target_language
            ),
        )
    except Exception as exc:
        yield _sse("error", {"message": str(exc)})
        return

    yield _sse("analysis", {"data": analysis})
    yield _sse(
        "status",
        {"stage": "translating", "message": "Translation complete.", "progress": 38},
    )
    yield _sse("translation", {"data": translation})
    yield _sse(
        "status",
        {"stage": "evaluating", "message": "Evaluating translation quality…", "progress": 75},
    )

    translated_code = translation["translated_code"]

    try:
        (eval_result, eval_usage), (tests, tests_usage) = await asyncio.gather(
            evaluator.evaluate(request.code, translated_code, request.source_language),
            test_generator.generate_with_usage(translated_code, request.target_language),
        )
    except Exception as exc:
        yield _sse("error", {"message": str(exc)})
        return

    yield _sse("evaluation", {"data": eval_result})
    yield _sse(
        "status",
        {"stage": "testing", "message": "Test cases generated.", "progress": 88},
    )
    yield _sse("tests", {"data": tests})

    total_usage = _aggregate_usage(
        analysis_usage, translation_usage, eval_usage, tests_usage
    )
    response = ModernizeResponse(
        original_code=request.code,
        analysis=analysis.get("explanation", ""),
        complexity=analysis.get("complexity", "unknown"),
        key_components=analysis.get("key_components", []),
        translated_code=translated_code,
        translation_notes=translation.get("notes", ""),
        test_cases=tests.get("test_code", ""),
        test_notes=tests.get("notes", ""),
        evaluation=EvaluationResult(**eval_result),
        usage=total_usage,
    )

    yield _sse("complete", {"data": response.model_dump()})
    yield _sse("done", {"message": "Pipeline complete.", "progress": 100})


@app.get("/stream/{run_id}/{file_index}")
async def stream_batch_item(run_id: str, file_index: int) -> StreamingResponse:
    items = BATCH_RUNS.get(run_id)
    if items is None:
        raise fastapi.HTTPException(status_code=404, detail="Unknown run_id")
    if file_index < 0 or file_index >= len(items):
        raise fastapi.HTTPException(status_code=404, detail="Invalid file index")

    item = items[file_index]
    if not item.code.strip():

        def empty_err():
            yield f'event: error\ndata: {json.dumps({"message": "Empty code"})}\n\n'

        return StreamingResponse(
            empty_err(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    inner = ModernizeRequest(
        code=item.code,
        source_language=item.source_language,
        target_language=item.target_language,
    )
    return StreamingResponse(
        _stream_single_modernize(inner),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _stream_pipeline(request: ModernizeRequest) -> AsyncIterator[str]:
    def _sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    yield _sse("status", {"stage": "analyzing", "message": "Analyzing legacy code…"})

    try:
        (analysis, _), (translation, _) = await asyncio.gather(
            analyzer.analyze_with_usage(request.code, request.source_language),
            translator.translate_with_usage(
                request.code, request.source_language, request.target_language
            ),
        )
    except Exception as exc:
        yield _sse("error", {"message": str(exc)})
        return

    yield _sse("analysis", {"data": analysis})
    yield _sse("status", {"stage": "translating", "message": "Translation complete."})
    yield _sse("translation", {"data": translation})
    yield _sse("status", {"stage": "evaluating", "message": "Evaluating translation quality…"})

    translated_code = translation["translated_code"]

    try:
        (eval_result, eval_usage), (tests, tests_usage) = await asyncio.gather(
            evaluator.evaluate(request.code, translated_code, request.source_language),
            test_generator.generate_with_usage(translated_code, request.target_language),
        )
    except Exception as exc:
        yield _sse("error", {"message": str(exc)})
        return

    yield _sse("evaluation", {"data": eval_result})
    yield _sse("status", {"stage": "testing", "message": "Test cases generated."})
    yield _sse("tests", {"data": tests})
    yield _sse("done", {"message": "Pipeline complete."})


@app.post("/stream-modernize")
async def stream_modernize(request: ModernizeRequest) -> StreamingResponse:
    return StreamingResponse(
        _stream_pipeline(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
