"""Combined Presidio REST service: analyzer + anonymizer on one port.

Constructs one warm AnalyzerEngine (with a native check-digit VIN recognizer)
and one AnonymizerEngine at startup, exposing stock-compatible endpoints so a
single PRESIDIO_URL serves both. English only.
"""

from typing import Any

from fastapi import Body, FastAPI
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer, RecognizerResult
from presidio_analyzer.predefined_recognizers import (
    AuAbnRecognizer,
    AuAcnRecognizer,
    AuMedicareRecognizer,
    AuTfnRecognizer,
    InAadhaarRecognizer,
    InPanRecognizer,
    InPassportRecognizer,
    InVehicleRegistrationRecognizer,
    InVoterRecognizer,
    SgFinRecognizer,
    SgUenRecognizer,
    UkNinoRecognizer,
)
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

# English-capable predefined recognizers Presidio ships but does NOT load by
# default (UK_NINO, AU_*, IN_*, SG_*). es/it/pl/fi/th/ko recognizers are
# language-locked and excluded — this image is English only.
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
    analyzer = AnalyzerEngine()
    vin_pattern = Pattern(name="vin", regex=r"\b[A-HJ-NPR-Z0-9]{17}\b", score=0.7)
    analyzer.registry.add_recognizer(
        VinRecognizer(
            supported_entity="VIN",
            patterns=[vin_pattern],
            context=["vin", "vehicle", "chassis"],
        )
    )
    for recognizer_cls in EXTRA_RECOGNIZERS:
        analyzer.registry.add_recognizer(recognizer_cls())
    return analyzer


analyzer = build_analyzer()
anonymizer = AnonymizerEngine()

app = FastAPI(title="Sim Presidio", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/supportedentities")
def supported_entities(language: str = "en") -> list[str]:
    return analyzer.get_supported_entities(language)


@app.post("/analyze")
def analyze(payload: dict[str, Any] = Body(...)) -> list[dict[str, Any]]:
    entities = payload.get("entities") or None
    results = analyzer.analyze(
        text=payload["text"],
        language=payload.get("language", "en"),
        entities=entities,
        score_threshold=payload.get("score_threshold"),
        return_decision_process=payload.get("return_decision_process", False),
    )
    return [r.to_dict() for r in results]


@app.post("/anonymize")
def anonymize(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    analyzer_results = [
        RecognizerResult(
            entity_type=r["entity_type"],
            start=r["start"],
            end=r["end"],
            score=r.get("score", 1.0),
        )
        for r in payload.get("analyzer_results", [])
    ]
    raw_operators = payload.get("anonymizers") or payload.get("operators")
    operators = None
    if raw_operators:
        operators = {}
        for entity, cfg in raw_operators.items():
            cfg = dict(cfg)
            operators[entity] = OperatorConfig(cfg.pop("type"), cfg)
    result = anonymizer.anonymize(
        text=payload["text"],
        analyzer_results=analyzer_results,
        operators=operators,
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
