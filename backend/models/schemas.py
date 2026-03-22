"""
Pydantic models for API request/response schemas.
Extended with evaluation results and token usage tracking.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Request Models ──────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    code: str = Field(..., description="Legacy code to analyze")
    language: str = Field(default="powerbuilder", description="Source language")


class TranslateRequest(BaseModel):
    code: str = Field(..., description="Code to translate")
    source_language: str = Field(default="powerbuilder", description="Source language")
    target_language: str = Field(default="csharp", description="Target language")


class TestGenerateRequest(BaseModel):
    code: str = Field(..., description="Code to generate tests for")
    language: str = Field(default="csharp", description="Code language")


class ModernizeRequest(BaseModel):
    code: str = Field(..., description="Legacy code to modernize")
    source_language: str = Field(default="powerbuilder", description="Source language")
    target_language: str = Field(default="csharp", description="Target language")


# ── Shared Sub-Models ────────────────────────────────────────────────────────

class UsageStats(BaseModel):
    """Aggregated token usage and estimated cost for the full pipeline run."""
    prompt_tokens: int = Field(0, description="Total prompt tokens consumed")
    completion_tokens: int = Field(0, description="Total completion tokens generated")
    total_tokens: int = Field(0, description="Sum of prompt + completion tokens")
    estimated_cost_usd: float = Field(0.0, description="Estimated USD cost at list pricing")


class EvaluationResult(BaseModel):
    """Structured output from the EvaluatorAgent (LLM-as-judge)."""
    faithfulness_score: int = Field(..., ge=0, le=100, description="Logic preservation score 0–100")
    idiomaticity_score: int = Field(..., ge=0, le=100, description="C# idiom quality score 0–100")
    risk_level: str = Field(..., description="Deployment risk: Low | Medium | High")
    strengths: list[str] = Field(default_factory=list, description="What the translation did well")
    issues: list[str] = Field(default_factory=list, description="Issues found in the translation")
    reviewer_note: str = Field(..., description="Overall quality summary from the LLM judge")


# ── Response Models ──────────────────────────────────────────────────────────

class AnalyzeResponse(BaseModel):
    explanation: str = Field(..., description="Human-readable explanation of the code")
    complexity: str = Field(..., description="Complexity assessment: low | medium | high")
    key_components: list[str] = Field(..., description="Main components identified")


class TranslateResponse(BaseModel):
    translated_code: str = Field(..., description="Translated code")
    notes: str = Field(..., description="Translation notes and considerations")


class TestGenerateResponse(BaseModel):
    test_code: str = Field(..., description="Generated test code")
    notes: str = Field(..., description="Testing notes and coverage info")


class ModernizeResponse(BaseModel):
    original_code: str
    analysis: str
    complexity: str
    key_components: list[str]
    translated_code: str
    translation_notes: str
    test_cases: str
    test_notes: str
    evaluation: EvaluationResult
    usage: UsageStats
