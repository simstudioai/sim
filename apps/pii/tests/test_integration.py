"""Integration tests — exercise the real engines end-to-end via the FastAPI app.

Requires the models present, so run inside the built images (gated behind
RUN_PII_INTEGRATION to keep plain `pytest` runs model-free):

    # spacy regression (default engine)
    docker run --rm -e RUN_PII_INTEGRATION=1 <pii-image> python -m pytest tests

    # gliner engine
    docker run --rm -e RUN_PII_INTEGRATION=1 -e PII_ENGINE=gliner <pii-image> \
        python -m pytest tests/test_integration.py

The suite adapts to PII_ENGINE: shared assertions always run, engine-specific
ones only for the active engine.
"""

import os

import pytest

if not os.environ.get("RUN_PII_INTEGRATION"):
    pytest.skip(
        "integration tests need the built image (RUN_PII_INTEGRATION=1)",
        allow_module_level=True,
    )

from fastapi.testclient import TestClient

import server

ENGINE = server.PII_ENGINE
client = TestClient(server.app)


def redact_batch(texts, language="en"):
    response = client.post("/redact_batch", json={"texts": texts, "language": language})
    assert response.status_code == 200
    return response.json()["texts"]


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_masks_person_and_email():
    [masked] = redact_batch(["My name is John Smith, email john.smith@example.com."])
    assert "<PERSON>" in masked
    assert "<EMAIL_ADDRESS>" in masked
    assert "John Smith" not in masked
    assert "john.smith@example.com" not in masked


def test_masks_location_and_phone():
    [masked] = redact_batch(["I live in Paris, call me at (212) 555-0123."])
    assert "<LOCATION>" in masked
    assert "<PHONE_NUMBER>" in masked
    assert "Paris" not in masked


def test_regex_recognizers_fire_in_non_english_languages():
    [masked] = redact_batch(["Mi NIF es 12345678Z."], language="es")
    assert "<ES_NIF>" in masked
    # On the spacy engine the it_core_news_lg NER tags the fiscal code as
    # ORGANIZATION and outscores the pattern recognizer, so only assert the
    # value is masked; the exact label is checked on the gliner engine where
    # spaCy NER can't compete.
    [masked] = redact_batch(["Il codice fiscale è RSSMRA85T10A562S."], language="it")
    assert "RSSMRA85T10A562S" not in masked
    if ENGINE == "gliner":
        assert "<IT_FISCAL_CODE>" in masked


def test_vin_checksum_recognizer_fires():
    [masked] = redact_batch(["The car VIN is 1HGCM82633A004352."])
    assert "<VIN>" in masked


def test_no_pii_passes_through_unchanged():
    # NB: "Quarterly" would be tagged DATE_TIME by the spacy engine — keep
    # this text free of anything either engine considers an entity.
    text = "Revenue grew and margins held steady."
    assert redact_batch([text]) == [text]


@pytest.mark.skipif(ENGINE != "gliner", reason="gliner-only wiring assertions")
def test_gliner_registry_has_no_spacy_recognizer():
    names = {r.name for r in server.analyzer.registry.recognizers}
    assert "SpacyRecognizer" not in names
    assert "GLiNERRecognizer" in names


@pytest.mark.skipif(ENGINE != "gliner", reason="gliner-only wiring assertions")
def test_gliner_supported_entities_keep_ner_types():
    supported = set(server.analyzer.get_supported_entities("en"))
    assert {"PERSON", "LOCATION", "NRP", "DATE_TIME"} <= supported


@pytest.mark.skipif(ENGINE != "spacy", reason="spacy-only wiring assertions")
def test_spacy_registry_unchanged():
    names = {r.name for r in server.analyzer.registry.recognizers}
    assert "SpacyRecognizer" in names
    assert "GLiNERRecognizer" not in names
