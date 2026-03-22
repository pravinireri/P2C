"""
Pydantic schemas for request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ModernizeRequest(BaseModel):
    legacy_code: str = Field(
        ...,
        min_length=10,
        description="The PowerBuilder (or other legacy) source code to modernize",
        example="// PowerBuilder sample code here",
    )
    source_language: str = Field(
        default="PowerBuilder",
        description="The source language of the legacy code",
    )
    include_tests: bool = Field(
        default=True,
        description="Whether to generate unit tests for the translated code",
    )


class AnalysisResult(BaseModel):
    summary: str
    complexity: str  # Low / Medium / High
    key_constructs: list[str]
    potential_issues: list[str]


class ModernizeResponse(BaseModel):
    analysis: AnalysisResult
    translated_code: str
    test_cases: Optional[str] = None
    source_language: str
    target_language: str = "C#"
