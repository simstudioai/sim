"""Combined Presidio REST service: analyzer + anonymizer on one port.

Constructs one warm AnalyzerEngine (multi-language NLP + a native check-digit
VIN recognizer) and one AnonymizerEngine at startup, exposing stock-compatible
endpoints so a single PRESIDIO_URL serves both.
"""

import logging
import time
from typing import Any

from fastapi import FastAPI
from presidio_analyzer import (
    AnalyzerEngine,
    BatchAnalyzerEngine,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import (
    AuAbnRecognizer,
    AuAcnRecognizer,
    AuMedicareRecognizer,
    AuTfnRecognizer,
    EsNieRecognizer,
    EsNifRecognizer,
    FiPersonalIdentityCodeRecognizer,
    InAadhaarRecognizer,
    InPanRecognizer,
    InPassportRecognizer,
    InVehicleRegistrationRecognizer,
    InVoterRecognizer,
    ItDriverLicenseRecognizer,
    ItFiscalCodeRecognizer,
    ItIdentityCardRecognizer,
    ItPassportRecognizer,
    ItVatCodeRecognizer,
    PlPeselRecognizer,
    SgFinRecognizer,
    SgUenRecognizer,
    UkNinoRecognizer,
)
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from pydantic import BaseModel

# Languages served. Each needs its spaCy model installed in the image; the
# es/it/pl/fi predefined recognizers (ES_NIF, IT_FISCAL_CODE, PL_PESEL, ...)
# auto-load once their NLP engine is present.
NLP_CONFIGURATION = {
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "en", "model_name": "en_core_web_lg"},
        {"lang_code": "es", "model_name": "es_core_news_lg"},
        {"lang_code": "it", "model_name": "it_core_news_lg"},
        {"lang_code": "pl", "model_name": "pl_core_news_lg"},
        {"lang_code": "fi", "model_name": "fi_core_news_lg"},
    ],
}
SUPPORTED_LANGUAGES = [m["lang_code"] for m in NLP_CONFIGURATION["models"]]

# Predefined recognizers Presidio ships but does NOT load into the default
# registry — they must be added explicitly. Each carries its own
# supported_language, so it fires under that language once its NLP model is
# loaded. en: UK/AU/IN/SG locale ids; es/it/pl/fi: national ids.
EXTRA_RECOGNIZERS = [
    UkNinoRecognizer,
    AuAbnRecognizer,
    AuAcnRecognizer,
    AuTfnRecognizer,
    AuMedicareRecognizer,
    InPanRecognizer,
    InAadhaarRecognizer,
    InVehicleRegistrationRecognizer,
    InVoterRecognizer,
    InPassportRecognizer,
    SgFinRecognizer,
    SgUenRecognizer,
    EsNifRecognizer,
    EsNieRecognizer,
    ItFiscalCodeRecognizer,
    ItDriverLicenseRecognizer,
    ItVatCodeRecognizer,
    ItPassportRecognizer,
    ItIdentityCardRecognizer,
    PlPeselRecognizer,
    FiPersonalIdentityCodeRecognizer,
]


class VinRecognizer(PatternRecognizer):
    """VIN (17 chars, A-Z/0-9 excluding I/O/Q) with ISO 3779 check-digit
    validation (position 9). Validation makes accidental matches on arbitrary
    17-char codes (request ids, SKUs, tokens) extremely unlikely. Some
    non-North-American VINs omit the check digit and are skipped — an
    intentional bias toward precision.
    """

    _TRANSLIT = {
        **{str(d): d for d in range(10)},
        "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8,
        "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "P": 7, "R": 9,
        "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9,
    }
    _WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

    def validate_result(self, pattern_text: str):
        vin = pattern_text.upper()
        if len(vin) != 17:
            return False
        try:
            total = sum(self._TRANSLIT[c] * w for c, w in zip(vin, self._WEIGHTS))
        except KeyError:
            return False
        check = total % 11
        expected = "X" if check == 10 else str(check)
        return vin[8] == expected


def build_analyzer() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(nlp_configuration=NLP_CONFIGURATION).create_engine()
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=SUPPORTED_LANGUAGES)
    # VIN is language-agnostic, so register it under every served language —
    # a recognizer only fires for the language the caller routes to.
    vin_pattern = Pattern(name="vin", regex=r"\b[A-HJ-NPR-Z0-9]{17}\b", score=0.7)
    for language in SUPPORTED_LANGUAGES:
        analyzer.registry.add_recognizer(
            VinRecognizer(
                supported_entity="VIN",
                patterns=[vin_pattern],
                context=["vin", "vehicle", "chassis"],
                supported_language=language,
            )
        )
    for recognizer_cls in EXTRA_RECOGNIZERS:
        analyzer.registry.add_recognizer(recognizer_cls())
    return analyzer


analyzer = build_analyzer()
batch_analyzer = BatchAnalyzerEngine(analyzer_engine=analyzer)
anonymizer = AnonymizerEngine()

# Propagates to uvicorn's root handler, so timing lands in the container log stream.
logger = logging.getLogger("sim.pii")

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
