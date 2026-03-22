"""
Legacy Code Modernization API — P2C
Main FastAPI application entry point.

Pipeline upgrades:
- Analyze + Translate run CONCURRENTLY via asyncio.gather (halves latency)
- EvaluatorAgent scores the translation after it completes
- All agent calls return UsageStats; totals are aggregated and surfaced in response
- /stream-modernize sends SSE events so the frontend can show live progress
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import AsyncIterator

# Auto-load .env from the backend directory so the server starts without
# needing manually exported env vars in the shell session.
from dotenv import load_dotenv
# override=True ensures .env values beat any corrupted system environment variables
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

# ── Service + Agent Initialisation ──────────────────────────────────────────

llm_service = LLMService()
analyzer = AnalyzerAgent(llm_service)
translator = TranslatorAgent(llm_service)
test_generator = TestGeneratorAgent(llm_service)
evaluator = EvaluatorAgent(llm_service)


# ── Helper ──────────────────────────────────────────────────────────────────

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


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


# ── Individual Endpoints ─────────────────────────────────────────────────────

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_code(request: AnalyzeRequest) -> AnalyzeResponse:
    """Analyze legacy code and provide an explanation."""
    result = await analyzer.analyze(request.code, request.language)
    return AnalyzeResponse(**result)


@app.post("/translate", response_model=TranslateResponse)
async def translate_code(request: TranslateRequest) -> TranslateResponse:
    """Translate legacy code to the target language."""
    result = await translator.translate(
        request.code, request.source_language, request.target_language
    )
    return TranslateResponse(**result)


@app.post("/generate-tests", response_model=TestGenerateResponse)
async def generate_tests(request: TestGenerateRequest) -> TestGenerateResponse:
    """Generate unit tests for translated code."""
    result = await test_generator.generate(request.code, request.language)
    return TestGenerateResponse(**result)


# ── Full Pipeline ─────────────────────────────────────────────────────────────

@app.post("/modernize", response_model=ModernizeResponse)
async def modernize_code(request: ModernizeRequest) -> ModernizeResponse:
    """
    Full 4-stage pipeline:
    1+2. Analyze + Translate concurrently
    3.   Evaluate translation quality (LLM-as-judge)
    4.   Generate xUnit tests
    """
    import openai as _openai
    try:
        # Stage 1+2: run concurrently — independent of each other
        (analysis, analysis_usage), (translation, translation_usage) = await asyncio.gather(
            analyzer.analyze_with_usage(request.code, request.source_language),
            translator.translate_with_usage(
                request.code, request.source_language, request.target_language
            ),
        )

        translated_code = translation["translated_code"]

        # Stage 3+4: run concurrently — evaluator and test generator both need translated code
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

    except _openai.RateLimitError:
        raise fastapi.HTTPException(
            status_code=429,
            detail="OpenAI rate limit exceeded. Your account has hit its usage quota. "
                   "Check https://platform.openai.com/usage or wait a moment and retry.",
        )
    except _openai.AuthenticationError:
        raise fastapi.HTTPException(
            status_code=401,
            detail="Invalid OpenAI API key. Check OPENAI_API_KEY in backend/.env.",
        )
    except _openai.APIError as exc:
        raise fastapi.HTTPException(status_code=502, detail=f"OpenAI API error: {exc}")
    except Exception as exc:
        raise fastapi.HTTPException(status_code=500, detail=str(exc))


# ── Streaming Endpoint (SSE) ──────────────────────────────────────────────────

async def _stream_pipeline(request: ModernizeRequest) -> AsyncIterator[str]:
    """
    Server-Sent Events generator for the modernize pipeline.
    Each stage emits a typed SSE event so the frontend can update incrementally.
    """

    def _sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"

    yield _sse("status", {"stage": "analyzing", "message": "Analyzing legacy code…"})

    # Stage 1+2 concurrent
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

    # Stage 3+4 concurrent
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
    """
    Streaming version of /modernize using Server-Sent Events.
    The frontend connects to this for real-time stage-by-stage updates.
    """
    return StreamingResponse(
        _stream_pipeline(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
