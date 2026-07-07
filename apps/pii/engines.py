"""Analyzer engine builders for the PII service.

Two NER engines share one recognizer surface:

- spacy (default): the 5 large spaCy models do NER (PERSON/LOCATION/NRP/
  DATE_TIME) and tokenization.
- gliner (opt-in): one multilingual GLiNER model does NER on CPU or GPU;
  small spaCy models remain only for tokenization + lemmas.

Both engines register the identical regex/checksum recognizer set (Presidio
defaults, EXTRA_RECOGNIZERS, VIN) — only the source of the 4 NER entity types
differs. Side-effect free: importing this module loads no models.
"""

import importlib.util

import spacy.util
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import (
    AuAbnRecognizer,
    AuAcnRecognizer,
    AuMedicareRecognizer,
    AuTfnRecognizer,
    EsNieRecognizer,
    EsNifRecognizer,
    FiPersonalIdentityCodeRecognizer,
    GLiNERRecognizer,
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

# The gliner engine still needs a spaCy pipeline per language: the regex
# recognizers consume NlpArtifacts and the LemmaContextAwareEnhancer boosts
# scores from surrounding lemmas. The small models (~12-40MB each vs ~400MB
# large) keep tokenization + lemmas intact while GLiNER owns NER. Blank
# pipelines ("blank:xx") are not an option: Presidio's SpacyNlpEngine treats
# unknown model names as pip packages and tries to download them.
# labels_to_ignore strips the small models' NER output from NlpArtifacts —
# correctness comes from removing SpacyRecognizer in build_gliner_analyzer;
# this only silences unmapped-label noise.
GLINER_NLP_CONFIGURATION = {
    "nlp_engine_name": "spacy",
    "models": [
        {"lang_code": "en", "model_name": "en_core_web_sm"},
        {"lang_code": "es", "model_name": "es_core_news_sm"},
        {"lang_code": "it", "model_name": "it_core_news_sm"},
        {"lang_code": "pl", "model_name": "pl_core_news_sm"},
        {"lang_code": "fi", "model_name": "fi_core_news_sm"},
    ],
    "ner_model_configuration": {
        "labels_to_ignore": [
            "CARDINAL", "DATE", "EVENT", "FAC", "GPE", "LANGUAGE", "LAW",
            "LOC", "MISC", "MONEY", "NORP", "ORDINAL", "ORG", "PER",
            "PERCENT", "PERSON", "PRODUCT", "QUANTITY", "TIME", "WORK_OF_ART",
        ],
    },
}

# Zero-shot label prompts -> the 4 Presidio NER entities GLiNER owns. Multiple
# prompts per entity trade a little inference cost for recall; tune against
# scripts/bench_engines.py output.
GLINER_ENTITY_MAPPING = {
    "person": "PERSON",
    "name": "PERSON",
    "location": "LOCATION",
    "address": "LOCATION",
    "date": "DATE_TIME",
    "time": "DATE_TIME",
    "nationality": "NRP",
    "religious group": "NRP",
    "political group": "NRP",
    "ethnic group": "NRP",
}

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


class SharedModelGLiNERRecognizer(GLiNERRecognizer):
    """Per-language GLiNER recognizer sharing ONE loaded model.

    Presidio routes recognizers by supported_language, so the registry holds
    one instance per served language — but each instance's load() would pull
    its own ~1.2GB model copy. The first instance loads (an ImportError from
    a missing gliner package propagates — fail fast in the lean image); the
    rest reuse the cached model.
    """

    _shared_models: dict = {}

    def load(self) -> None:
        key = (self.model_name, self.map_location)
        cached = self._shared_models.get(key)
        if cached is None:
            super().load()
            self._shared_models[key] = self.gliner
        else:
            self.gliner = cached

    def analyze(self, text, entities, nlp_artifacts=None):
        """GLiNERRecognizer appends any requested entity it doesn't know as an
        ad-hoc zero-shot label and returns its hits. The analyzer passes ALL
        supported entities (~40) when a request doesn't narrow them, which
        would prompt GLiNER for CREDIT_CARD/VIN/ES_NIF/... — wrong scope, and
        inference cost scales with label count. Restrict to the NER entities
        this recognizer owns."""
        requested = [e for e in (entities or self.supported_entities) if e in self.supported_entities]
        if not requested:
            return []
        return super().analyze(text, requested, nlp_artifacts)


def _register_common_recognizers(analyzer: AnalyzerEngine) -> None:
    """Regex/checksum recognizers shared by both engines."""
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


def build_spacy_analyzer() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(nlp_configuration=NLP_CONFIGURATION).create_engine()
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=SUPPORTED_LANGUAGES)
    _register_common_recognizers(analyzer)
    return analyzer


def build_gliner_analyzer(model_name: str, device: str | None) -> AnalyzerEngine:
    """GLiNER engine: one multilingual zero-shot model replaces spaCy NER for
    PERSON/LOCATION/NRP/DATE_TIME; everything else is unchanged.

    :param model_name: HuggingFace id of the GLiNER model.
    :param device: torch device ("cpu", "cuda", "cuda:0"); None auto-detects
        via Presidio's device_detector (cuda when available, else cpu).
    """
    # Fail fast with an actionable message on the lean image. Without these
    # checks Presidio would try to pip-download the missing spaCy models at
    # startup (a silent network fallback that dies with an unrelated pip
    # permission error), and the gliner ImportError would surface only later.
    if importlib.util.find_spec("gliner") is None:
        raise RuntimeError(
            "PII_ENGINE=gliner requires the gliner image variant "
            "(docker build --target gliner); the gliner package is not installed"
        )
    missing = [
        m["model_name"]
        for m in GLINER_NLP_CONFIGURATION["models"]
        if not spacy.util.is_package(m["model_name"])
    ]
    if missing:
        raise RuntimeError(
            f"PII_ENGINE=gliner needs spaCy models {missing}; "
            "use the gliner image variant (docker build --target gliner)"
        )
    nlp_engine = NlpEngineProvider(nlp_configuration=GLINER_NLP_CONFIGURATION).create_engine()
    analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=SUPPORTED_LANGUAGES)
    # The default registry wires SpacyRecognizer per language; with GLiNER
    # owning the NER entities it would emit duplicate/competing spans from the
    # small models' ner pipe. remove_recognizer only logs when nothing matched,
    # so assert the removal actually happened.
    analyzer.registry.remove_recognizer("SpacyRecognizer")
    if any(r.name == "SpacyRecognizer" for r in analyzer.registry.recognizers):
        raise RuntimeError("SpacyRecognizer removal failed; Presidio registry layout changed")
    for language in SUPPORTED_LANGUAGES:
        analyzer.registry.add_recognizer(
            SharedModelGLiNERRecognizer(
                entity_mapping=GLINER_ENTITY_MAPPING,
                model_name=model_name,
                map_location=device,
                supported_language=language,
            )
        )
    _register_common_recognizers(analyzer)
    return analyzer
