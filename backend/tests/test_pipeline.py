from __future__ import annotations

from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import os
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy-key")

from backend.main import app  # noqa: E402
from backend.services.llm_service import UsageStats  # noqa: E402

client = TestClient(app)

DUMMY_USAGE = UsageStats(prompt_tokens=100, completion_tokens=200, total_tokens=300, estimated_cost_usd=0.00015)

DUMMY_ANALYSIS = {
    "explanation": "This is a test event handler.",
    "complexity": "low",
    "key_components": ["DataWindow", "MessageBox"],
}
DUMMY_TRANSLATION = {
    "translated_code": 'public void OnClick() { Console.WriteLine("Hello"); }',
    "notes": "No issues.",
}
DUMMY_EVALUATION = {
    "faithfulness_score": 92,
    "idiomaticity_score": 88,
    "risk_level": "Low",
    "strengths": ["Good async usage"],
    "issues": [],
    "reviewer_note": "Solid translation.",
}
DUMMY_TESTS = {
    "test_code": "[Fact] public void OnClick_WhenCalled_PrintsHello() { }",
    "notes": "Happy path covered.",
}


def _make_mock_llm():
    mock = MagicMock()
    mock.complete_with_usage = AsyncMock(return_value=("mocked", DUMMY_USAGE))
    return mock

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@patch("backend.main.analyzer")
@patch("backend.main.translator")
@patch("backend.main.evaluator")
@patch("backend.main.test_generator")
def test_modernize_schema(mock_tests, mock_eval, mock_trans, mock_analyzer):
    mock_analyzer.analyze_with_usage = AsyncMock(return_value=(DUMMY_ANALYSIS, DUMMY_USAGE))
    mock_trans.translate_with_usage = AsyncMock(return_value=(DUMMY_TRANSLATION, DUMMY_USAGE))
    mock_eval.evaluate = AsyncMock(return_value=(DUMMY_EVALUATION, DUMMY_USAGE))
    mock_tests.generate_with_usage = AsyncMock(return_value=(DUMMY_TESTS, DUMMY_USAGE))

    response = client.post(
        "/modernize",
        json={"code": "event clicked()\nend event", "source_language": "powerbuilder"},
    )

    assert response.status_code == 200, response.text
    data = response.json()

    assert isinstance(data["analysis"], str)
    assert isinstance(data["translated_code"], str)
    assert isinstance(data["test_cases"], str)

    assert "evaluation" in data
    ev = data["evaluation"]
    assert 0 <= ev["faithfulness_score"] <= 100
    assert 0 <= ev["idiomaticity_score"] <= 100
    assert ev["risk_level"] in ("Low", "Medium", "High")

    assert "usage" in data
    usage = data["usage"]
    assert usage["total_tokens"] > 0
    assert isinstance(usage["estimated_cost_usd"], float)


@patch("backend.main.analyzer")
@patch("backend.main.translator")
@patch("backend.main.evaluator")
@patch("backend.main.test_generator")
def test_modernize_returns_key_components(mock_tests, mock_eval, mock_trans, mock_analyzer):
    mock_analyzer.analyze_with_usage = AsyncMock(return_value=(DUMMY_ANALYSIS, DUMMY_USAGE))
    mock_trans.translate_with_usage = AsyncMock(return_value=(DUMMY_TRANSLATION, DUMMY_USAGE))
    mock_eval.evaluate = AsyncMock(return_value=(DUMMY_EVALUATION, DUMMY_USAGE))
    mock_tests.generate_with_usage = AsyncMock(return_value=(DUMMY_TESTS, DUMMY_USAGE))

    response = client.post(
        "/modernize",
        json={"code": "event clicked()\nend event"},
    )
    assert response.status_code == 200
    components = response.json()["key_components"]
    assert isinstance(components, list)
    assert all(isinstance(c, str) for c in components)


def test_modernize_rejects_missing_code():
    response = client.post("/modernize", json={"source_language": "powerbuilder"})
    assert response.status_code == 422
