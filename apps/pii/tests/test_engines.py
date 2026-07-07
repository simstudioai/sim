"""Unit tests for engines.py — no models, no downloads, no network.

Run: pip install -r requirements.txt -r requirements-dev.txt && python -m pytest tests
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest
from presidio_analyzer.predefined_recognizers.ner import gliner_recognizer

import engines

PII_DIR = Path(__file__).resolve().parent.parent


class FakeModel:
    def __init__(self):
        self.seen_labels: list[list[str]] = []

    def predict_entities(self, text, labels, flat_ner=True, threshold=0.3, multi_label=False):
        self.seen_labels.append(list(labels))
        return [{"label": "person", "score": 0.92, "start": 0, "end": 4, "text": text[0:4]}]


class FakeGLiNER:
    calls = 0

    @classmethod
    def from_pretrained(cls, model_name, **kwargs):
        cls.calls += 1
        return FakeModel()


@pytest.fixture
def fake_gliner(monkeypatch):
    monkeypatch.setattr(gliner_recognizer, "GLiNER", FakeGLiNER)
    engines.SharedModelGLiNERRecognizer._shared_models.clear()
    FakeGLiNER.calls = 0
    yield FakeGLiNER
    engines.SharedModelGLiNERRecognizer._shared_models.clear()


def make_recognizer(language: str):
    return engines.SharedModelGLiNERRecognizer(
        entity_mapping=engines.GLINER_ENTITY_MAPPING,
        model_name="fake/model",
        map_location="cpu",
        supported_language=language,
    )


def test_invalid_pii_engine_fails_import():
    result = subprocess.run(
        [sys.executable, "-c", "import server"],
        cwd=PII_DIR,
        env={**os.environ, "PII_ENGINE": "bogus"},
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "Invalid PII_ENGINE" in result.stderr


@pytest.mark.skipif(
    importlib.util.find_spec("gliner") is not None,
    reason="fail-fast path only exists when gliner is not installed",
)
def test_build_gliner_analyzer_fails_fast_without_gliner():
    with pytest.raises(RuntimeError, match="gliner image variant"):
        engines.build_gliner_analyzer(model_name="fake/model", device="cpu")


def test_shared_model_loads_once_across_languages(fake_gliner):
    first = make_recognizer("en")
    second = make_recognizer("es")
    assert fake_gliner.calls == 1
    assert first.gliner is second.gliner


def test_analyze_never_prompts_gliner_with_foreign_entities(fake_gliner):
    recognizer = make_recognizer("en")
    all_supported = ["PERSON", "LOCATION", "NRP", "DATE_TIME", "CREDIT_CARD", "VIN", "ES_NIF"]
    results = recognizer.analyze("John went home", entities=all_supported)
    for labels in recognizer.gliner.seen_labels:
        assert set(labels) <= set(engines.GLINER_ENTITY_MAPPING)
    assert results and results[0].entity_type == "PERSON"


def test_analyze_skips_inference_when_no_owned_entity_requested(fake_gliner):
    recognizer = make_recognizer("en")
    assert recognizer.analyze("4111111111111111", entities=["CREDIT_CARD"]) == []
    assert recognizer.gliner.seen_labels == []


def test_entity_mapping_targets_exactly_the_ner_entities():
    assert set(engines.GLINER_ENTITY_MAPPING.values()) == {
        "PERSON",
        "LOCATION",
        "NRP",
        "DATE_TIME",
    }
