"""Combined Presidio REST service: analyzer + anonymizer on one port.

Constructs one warm AnalyzerEngine (multi-language NLP + a native check-digit
VIN recognizer) and one AnonymizerEngine at startup, exposing stock-compatible
endpoints so a single PRESIDIO_URL serves both.

NER engine selection (see engines.py):
- PII_ENGINE=spacy (default): the 5 large spaCy models, unchanged behavior.
- PII_ENGINE=gliner: one multilingual GLiNER model for PERSON/LOCATION/NRP/
  DATE_TIME. The stock image ships both engines, so this is a pure env flip.
  PII_DEVICE picks cpu/cuda (unset = auto-detect), PII_GLINER_MODEL overrides
  the model id. The same code runs on CPU and GPU. Each uvicorn worker
  (PII_WORKERS) loads its own GLiNER model copy — into GPU memory when on
  cuda — so GPU deployments generally want PII_WORKERS=1 per GPU, unlike the
  CPU/spacy path where workers scale with vCPUs.
"""

import logging
import os
import time
from typing import Any

from engines import build_gliner_analyzer, build_spacy_analyzer
from fastapi import FastAPI
from presidio_analyzer import AnalyzerEngine, BatchAnalyzerEngine, RecognizerResult
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from pydantic import BaseModel

PII_ENGINE = os.environ.get("PII_ENGINE", "spacy")
if PII_ENGINE not in ("spacy", "gliner"):
    raise ValueError(f"Invalid PII_ENGINE={PII_ENGINE!r}; expected 'spacy' or 'gliner'")
# Empty/unset -> None -> auto-detect (cuda when torch sees a GPU, else cpu).
PII_DEVICE = os.environ.get("PII_DEVICE") or None
PII_GLINER_MODEL = os.environ.get("PII_GLINER_MODEL", "urchade/gliner_multi_pii-v1")

# Propagates to uvicorn's root handler, so timing lands in the container log stream.
logger = logging.getLogger("sim.pii")


def build_analyzer() -> AnalyzerEngine:
    if PII_ENGINE == "gliner":
        return build_gliner_analyzer(model_name=PII_GLINER_MODEL, device=PII_DEVICE)
    return build_spacy_analyzer()


logger.info("building analyzer engine=%s device=%s", PII_ENGINE, PII_DEVICE or "auto")
analyzer = build_analyzer()
batch_analyzer = BatchAnalyzerEngine(analyzer_engine=analyzer)
anonymizer = AnonymizerEngine()

app = FastAPI(title="Sim Presidio", docs_url=None, redoc_url=None)


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    return_decision_process: bool = False


class AnalyzeBatchRequest(BaseModel):
    texts: list[str]
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None


class AnonymizeRequest(BaseModel):
    text: str
    analyzer_results: list[dict[str, Any]] = []
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None


class AnonymizeBatchItem(BaseModel):
    text: str
    analyzer_results: list[dict[str, Any]] = []


class AnonymizeBatchRequest(BaseModel):
    items: list[AnonymizeBatchItem] = []
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None


class RedactRequest(BaseModel):
    text: str
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None


class RedactBatchRequest(BaseModel):
    texts: list[str]
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None


def build_operators(
    raw_operators: dict[str, dict[str, Any]] | None,
) -> dict[str, OperatorConfig] | None:
    if not raw_operators:
        return None
    operators: dict[str, OperatorConfig] = {}
    for entity, raw_cfg in raw_operators.items():
        op_cfg = dict(raw_cfg)
        op_type = op_cfg.pop("type", "replace")
        operators[entity] = OperatorConfig(op_type, op_cfg)
    return operators


def run_anonymize(
    text: str,
    raw_results: list[dict[str, Any]],
    operators: dict[str, OperatorConfig] | None,
):
    analyzer_results = [
        RecognizerResult(
            entity_type=r["entity_type"],
            start=r["start"],
            end=r["end"],
            score=r.get("score", 1.0),
        )
        for r in raw_results
    ]
    return anonymizer.anonymize(
        text=text,
        analyzer_results=analyzer_results,
        operators=operators,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/supportedentities")
def supported_entities(language: str = "en") -> list[str]:
    return analyzer.get_supported_entities(language)


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> list[dict[str, Any]]:
    started = time.perf_counter()
    results = analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=req.entities or None,
        score_threshold=req.score_threshold,
        return_decision_process=req.return_decision_process,
    )
    logger.info(
        "analyze lang=%s chars=%d entities=%d duration_ms=%.1f",
        req.language,
        len(req.text),
        len(results),
        (time.perf_counter() - started) * 1000,
    )
    return [r.to_dict() for r in results]


@app.post("/analyze_batch")
def analyze_batch(req: AnalyzeBatchRequest) -> list[list[dict[str, Any]]]:
    """Analyze many texts in one pass (spaCy nlp.pipe), returning one span list
    per input in request order — the batched counterpart to /analyze."""
    results = batch_analyzer.analyze_iterator(
        texts=req.texts,
        language=req.language,
        entities=req.entities or None,
        score_threshold=req.score_threshold,
    )
    return [[r.to_dict() for r in per_text] for per_text in results]


@app.post("/anonymize")
def anonymize(req: AnonymizeRequest) -> dict[str, Any]:
    started = time.perf_counter()
    operators = build_operators(req.anonymizers or req.operators)
    result = run_anonymize(req.text, req.analyzer_results, operators)
    logger.info(
        "anonymize chars=%d spans=%d duration_ms=%.1f",
        len(req.text),
        len(req.analyzer_results),
        (time.perf_counter() - started) * 1000,
    )
    return {
        "text": result.text,
        "items": [
            {
                "operator": item.operator,
                "entity_type": item.entity_type,
                "start": item.start,
                "end": item.end,
                "text": item.text,
            }
            for item in result.items
        ],
    }


@app.post("/anonymize_batch")
def anonymize_batch(req: AnonymizeBatchRequest) -> dict[str, list[str]]:
    """Mask many texts in one pass, returning masked text per item in request
    order — the batched counterpart to /anonymize. Anonymization is pure string
    work (no NLP), so callers should send only items with detected spans."""
    operators = build_operators(req.anonymizers or req.operators)
    return {
        "texts": [
            run_anonymize(item.text, item.analyzer_results, operators).text
            for item in req.items
        ]
    }


@app.post("/redact")
def redact(req: RedactRequest) -> dict[str, str]:
    """Analyze + anonymize one text in a single round-trip (the combined
    counterpart to /analyze followed by /anonymize). Returns masked text; a text
    with no detected PII passes through unchanged. The analyzer results feed the
    anonymizer directly (no dict round-trip)."""
    started = time.perf_counter()
    operators = build_operators(req.anonymizers or req.operators)
    results = analyzer.analyze(
        text=req.text,
        language=req.language,
        entities=req.entities or None,
        score_threshold=req.score_threshold,
    )
    text = (
        req.text
        if not results
        else anonymizer.anonymize(
            text=req.text, analyzer_results=results, operators=operators
        ).text
    )
    logger.info(
        "redact lang=%s chars=%d spans=%d duration_ms=%.1f",
        req.language,
        len(req.text),
        len(results),
        (time.perf_counter() - started) * 1000,
    )
    return {"text": text}


@app.post("/redact_batch")
def redact_batch(req: RedactBatchRequest) -> dict[str, list[str]]:
    """Analyze + anonymize many texts in a single round-trip (the combined
    counterpart to /analyze_batch followed by /anonymize_batch). Returns masked
    text per input in request order; texts with no detected PII pass through
    unchanged. Analysis batches through spaCy nlp.pipe; the analyzer results feed
    the anonymizer directly (no dict round-trip), and anonymization runs only on
    texts that actually matched."""
    started = time.perf_counter()
    operators = build_operators(req.anonymizers or req.operators)
    analyzed = list(
        batch_analyzer.analyze_iterator(
            texts=req.texts,
            language=req.language,
            entities=req.entities or None,
            score_threshold=req.score_threshold,
        )
    )
    masked: list[str] = []
    total_spans = 0
    for text, per_text in zip(req.texts, analyzed):
        if not per_text:
            masked.append(text)
            continue
        total_spans += len(per_text)
        masked.append(
            anonymizer.anonymize(
                text=text, analyzer_results=per_text, operators=operators
            ).text
        )
    logger.info(
        "redact_batch lang=%s texts=%d spans=%d duration_ms=%.1f",
        req.language,
        len(req.texts),
        total_spans,
        (time.perf_counter() - started) * 1000,
    )
    return {"texts": masked}
