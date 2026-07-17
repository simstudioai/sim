"""Combined Presidio REST service: analyzer + anonymizer on one port.

Constructs one warm AnalyzerEngine (5 large spaCy models for NER +
regex/checksum pattern recognizers, incl. a native check-digit VIN recognizer)
and one AnonymizerEngine at startup, exposing stock-compatible endpoints so a
single PII_URL serves both.
"""

import logging
import time
from typing import Any

import regex as regex_module
from fastapi import FastAPI, HTTPException
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
    SpacyRecognizer,
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

# spaCy pipeline components PII detection does not use. NER depends only on
# `tok2vec` + `ner`; the parser (the most expensive stage), tagger, morphologizer,
# attribute_ruler and lemmatizer are dead weight here. Disabling them is a ~2x
# throughput win with NO change to the detected entities. The only side effect is
# that Presidio's lemma-based context score-boosting weakens slightly — an
# acceptable trade for the speed on this CPU-bound service.
NER_ONLY_DISABLE = ("parser", "tagger", "morphologizer", "attribute_ruler", "lemmatizer")

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


def _register_common_recognizers(analyzer: AnalyzerEngine) -> None:
    """Regex/checksum recognizers on top of spaCy NER + the Presidio defaults."""
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


def build_analyzer() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(nlp_configuration=NLP_CONFIGURATION).create_engine()
    for nlp in getattr(nlp_engine, "nlp", {}).values():
        for pipe in NER_ONLY_DISABLE:
            if pipe in nlp.pipe_names:
                nlp.disable_pipe(pipe)
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=SUPPORTED_LANGUAGES)
    _register_common_recognizers(analyzer)
    return analyzer


# Own handler at INFO. uvicorn configures only its own loggers, not the root, so a
# bare getLogger propagates to a handler-less root at the default WARNING level and
# every info() (the per-request timing lines) is silently dropped. Attach a stream
# handler directly and stop propagation so timing lands in the container log stream
# regardless of uvicorn's config or worker count.
logger = logging.getLogger("sim.pii")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _log_handler = logging.StreamHandler()
    _log_handler.setFormatter(logging.Formatter("%(levelname)s: %(name)s: %(message)s"))
    logger.addHandler(_log_handler)
    logger.propagate = False

logger.info("building analyzer (spacy)")
analyzer = build_analyzer()
batch_analyzer = BatchAnalyzerEngine(analyzer_engine=analyzer)
anonymizer = AnonymizerEngine()

# Every entity the spaCy NER recognizers can produce. A request touching any of
# these must run spaCy; a request naming only non-NER (regex/checksum) entities can
# skip it. Derived from the live registry so it stays authoritative if Presidio's
# default entity set changes (e.g. ORGANIZATION), unioned with a known floor so an
# unexpectedly empty derivation can never let an NER request skip the NLP pass.
_SPACY_NER_FLOOR = frozenset({"PERSON", "LOCATION", "NRP", "DATE_TIME", "ORGANIZATION"})
NER_ENTITIES = _SPACY_NER_FLOOR | frozenset(
    entity
    for recognizer in analyzer.registry.recognizers
    if isinstance(recognizer, SpacyRecognizer)
    for entity in recognizer.supported_entities
)

# One blank NlpArtifacts per language, built once at startup. Passing these to
# analyze() skips nlp_engine.process_text (the spaCy tok2vec+ner pass) entirely:
# the pattern recognizers still match on the raw text, SpacyRecognizer is excluded
# by the entity filter, and score_threshold is unset so detection is identical.
# Only context-based score boosting (which needs real tokens) is unavailable — an
# accepted trade for skipping NER on the hot block-output path. Read-only, so it
# is safe to share across requests and workers.
_BLANK_ARTIFACTS = {
    language: analyzer.nlp_engine.process_text("", language)
    for language in SUPPORTED_LANGUAGES
}


def _regex_only(entities: list[str] | None, score_threshold: float | None) -> bool:
    """True when the spaCy NLP pass can be skipped: the request names entities, none
    require spaCy NER, and no positive score_threshold is set. The blank-artifacts
    fast path drops context-based score boosting, which can only change what is
    returned when a threshold gates a match between its base and context-boosted
    score — so fall back to the full path whenever a threshold is in play."""
    return (
        bool(entities)
        and NER_ENTITIES.isdisjoint(entities)
        and (score_threshold is None or score_threshold <= 0)
    )


def _analyze_one(
    text: str,
    language: str,
    entities: list[str] | None,
    score_threshold: float | None,
    return_decision_process: bool = False,
    ad_hoc_recognizers: list[PatternRecognizer] | None = None,
):
    # Regex-only requests reuse a blank NlpArtifacts to skip the spaCy NLP pass;
    # otherwise analyze() computes artifacts (runs spaCy) as usual. Custom-pattern
    # recognizers are regex-based, so they run fine against the blank artifacts.
    nlp_artifacts = (
        _BLANK_ARTIFACTS.get(language) if _regex_only(entities, score_threshold) else None
    )
    return analyzer.analyze(
        text=text,
        language=language,
        entities=entities or None,
        score_threshold=score_threshold,
        return_decision_process=return_decision_process,
        nlp_artifacts=nlp_artifacts,
        ad_hoc_recognizers=ad_hoc_recognizers or None,
    )


def _analyze_many(
    texts: list[str],
    language: str,
    entities: list[str] | None,
    score_threshold: float | None,
    ad_hoc_recognizers: list[PatternRecognizer] | None = None,
):
    """Analyze many texts, skipping the spaCy pass for regex-only requests."""
    if _regex_only(entities, score_threshold):
        blank = _BLANK_ARTIFACTS.get(language)
        return [
            analyzer.analyze(
                text=text,
                language=language,
                entities=entities,
                score_threshold=score_threshold,
                nlp_artifacts=blank,
                ad_hoc_recognizers=ad_hoc_recognizers or None,
            )
            for text in texts
        ]
    return list(
        batch_analyzer.analyze_iterator(
            texts=texts,
            language=language,
            entities=entities or None,
            score_threshold=score_threshold,
            ad_hoc_recognizers=ad_hoc_recognizers or None,
        )
    )


app = FastAPI(title="Sim Presidio", docs_url=None, redoc_url=None)

# Internal entity id assigned to the i-th user-supplied custom pattern. Never
# surfaced: the anonymizer maps it back to the pattern's chosen `replacement`, and
# callers relabel any leftover CUSTOM_<i> span to the pattern's display name.
CUSTOM_ENTITY_PREFIX = "CUSTOM_"


class CustomPattern(BaseModel):
    """A user-supplied regex pattern. Matches are replaced with `replacement`,
    wrapped in angle brackets (see `_wrap_token`)."""

    regex: str
    replacement: str = ""
    name: str = ""


def _wrap_token(replacement: str) -> str:
    """Wrap the redaction token in angle brackets so custom matches read like the
    built-in Presidio tokens (`<PERSON>`, `<EMAIL_ADDRESS>`). A value the user
    already bracketed is left as-is so it never double-wraps to `<<X>>`."""
    if len(replacement) >= 2 and replacement.startswith("<") and replacement.endswith(">"):
        return replacement
    return f"<{replacement}>"


def custom_operators(patterns: list[CustomPattern] | None) -> dict[str, dict[str, Any]]:
    """Raw replace-operator per custom pattern, keyed by its internal entity id."""
    return {
        f"{CUSTOM_ENTITY_PREFIX}{i}": {"type": "replace", "new_value": _wrap_token(p.replacement)}
        for i, p in enumerate(patterns or [])
    }


def build_custom_recognizers(
    patterns: list[CustomPattern] | None, language: str
) -> tuple[list[PatternRecognizer], list[str]]:
    """Ad-hoc PatternRecognizers + their entity ids for the given custom patterns.

    Each regex is precompiled so a malformed pattern fails fast as a 400 rather
    than surfacing later as an opaque analyze-time 500."""
    recognizers: list[PatternRecognizer] = []
    entity_ids: list[str] = []
    for i, p in enumerate(patterns or []):
        try:
            regex_module.compile(p.regex)
        except regex_module.error as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid custom pattern regex: {exc}"
            ) from exc
        entity = f"{CUSTOM_ENTITY_PREFIX}{i}"
        recognizers.append(
            PatternRecognizer(
                supported_entity=entity,
                # Score 1.0 so a user's explicit pattern wins any overlap with a
                # built-in detector (e.g. spaCy tagging "EMP-123456" as ORGANIZATION
                # under detect-all). Presidio resolves overlapping spans by score, so
                # the custom replacement — not the built-in token — is applied.
                patterns=[Pattern(name=p.name or entity, regex=p.regex, score=1.0)],
                supported_language=language,
            )
        )
        entity_ids.append(entity)
    return recognizers, entity_ids


def resolve_entities(
    req_entities: list[str] | None, custom_entity_ids: list[str]
) -> list[str] | None:
    """Effective entity filter.

    `None` means detect-all built-ins (the guardrails "empty selection = detect
    everything" convention); the ad-hoc custom recognizers still fire under `None`,
    so adding a custom pattern augments detect-all rather than silently disabling
    the built-in detectors. An explicit list — including the empty list, which is
    the data-retention "only these custom patterns" shape — is used verbatim, with
    the custom ids appended."""
    if req_entities is None:
        return None
    return list(req_entities) + custom_entity_ids


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    return_decision_process: bool = False
    patterns: list[CustomPattern] | None = None


class AnalyzeBatchRequest(BaseModel):
    texts: list[str]
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    patterns: list[CustomPattern] | None = None


class AnonymizeRequest(BaseModel):
    text: str
    analyzer_results: list[dict[str, Any]] = []
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None
    patterns: list[CustomPattern] | None = None


class AnonymizeBatchItem(BaseModel):
    text: str
    analyzer_results: list[dict[str, Any]] = []


class AnonymizeBatchRequest(BaseModel):
    items: list[AnonymizeBatchItem] = []
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None
    patterns: list[CustomPattern] | None = None


class RedactRequest(BaseModel):
    text: str
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None
    patterns: list[CustomPattern] | None = None


class RedactBatchRequest(BaseModel):
    texts: list[str]
    language: str = "en"
    entities: list[str] | None = None
    score_threshold: float | None = None
    anonymizers: dict[str, dict[str, Any]] | None = None
    operators: dict[str, dict[str, Any]] | None = None
    patterns: list[CustomPattern] | None = None


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


def resolve_operators(
    anonymizers: dict[str, dict[str, Any]] | None,
    operators: dict[str, dict[str, Any]] | None,
    patterns: list[CustomPattern] | None,
) -> dict[str, OperatorConfig] | None:
    """Merge the caller's operators with the per-custom-pattern replace operators."""
    raw = dict(anonymizers or operators or {})
    raw.update(custom_operators(patterns))
    return build_operators(raw)


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
    recognizers, custom_ids = build_custom_recognizers(req.patterns, req.language)
    entities = resolve_entities(req.entities, custom_ids)
    results = _analyze_one(
        req.text,
        req.language,
        entities,
        req.score_threshold,
        req.return_decision_process,
        recognizers,
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
    recognizers, custom_ids = build_custom_recognizers(req.patterns, req.language)
    entities = resolve_entities(req.entities, custom_ids)
    results = _analyze_many(req.texts, req.language, entities, req.score_threshold, recognizers)
    return [[r.to_dict() for r in per_text] for per_text in results]


@app.post("/anonymize")
def anonymize(req: AnonymizeRequest) -> dict[str, Any]:
    started = time.perf_counter()
    operators = resolve_operators(req.anonymizers, req.operators, req.patterns)
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
    operators = resolve_operators(req.anonymizers, req.operators, req.patterns)
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
    recognizers, custom_ids = build_custom_recognizers(req.patterns, req.language)
    entities = resolve_entities(req.entities, custom_ids)
    operators = resolve_operators(req.anonymizers, req.operators, req.patterns)
    results = _analyze_one(
        req.text, req.language, entities, req.score_threshold, ad_hoc_recognizers=recognizers
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
    recognizers, custom_ids = build_custom_recognizers(req.patterns, req.language)
    entities = resolve_entities(req.entities, custom_ids)
    operators = resolve_operators(req.anonymizers, req.operators, req.patterns)
    analyzed = _analyze_many(req.texts, req.language, entities, req.score_threshold, recognizers)
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
        "redact_batch lang=%s texts=%d entities=%s nlp=%s spans=%d duration_ms=%.1f",
        req.language,
        len(req.texts),
        len(entities) if entities else "all",
        "skip" if _regex_only(entities, req.score_threshold) else "full",
        total_spans,
        (time.perf_counter() - started) * 1000,
    )
    return {"texts": masked}
