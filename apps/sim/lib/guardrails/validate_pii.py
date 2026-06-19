#!/usr/bin/env python3
"""
PII Detection Validator using Microsoft Presidio

Detects personally identifiable information (PII) in text and either:
- Blocks the request if PII is detected (block mode)
- Masks the PII and returns the masked text (mask mode)
"""

import sys
import json
from typing import List, Dict, Any

try:
    from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig
except ImportError:
    print(json.dumps({
        "passed": False,
        "error": "Presidio not installed. Run: pip install presidio-analyzer presidio-anonymizer",
        "detectedEntities": []
    }))
    sys.exit(0)


class VinRecognizer(PatternRecognizer):
    """
    Recognizes Vehicle Identification Numbers (17 chars, A-Z/0-9 excluding
    I/O/Q) and validates the ISO 3779 check digit (position 9). Validation makes
    accidental matches on arbitrary 17-char codes (request ids, SKUs, tokens)
    extremely unlikely. Note: some non-North-American VINs don't use the check
    digit and will be skipped — an intentional bias toward precision.
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


def build_analyzer() -> "AnalyzerEngine":
    """
    AnalyzerEngine with custom recognizers registered on top of the Presidio
    defaults. Adds a check-digit-validated VIN recognizer.
    """
    analyzer = AnalyzerEngine()
    vin_pattern = Pattern(name="vin", regex=r"\b[A-HJ-NPR-Z0-9]{17}\b", score=0.7)
    vin_recognizer = VinRecognizer(
        supported_entity="VIN",
        patterns=[vin_pattern],
        context=["vin", "vehicle", "chassis"],
    )
    analyzer.registry.add_recognizer(vin_recognizer)
    return analyzer


def detect_pii(
    text: str,
    entity_types: List[str],
    mode: str = "block",
    language: str = "en"
) -> Dict[str, Any]:
    """
    Detect PII in text using Presidio
    
    Args:
        text: Input text to analyze
        entity_types: List of PII entity types to detect (e.g., ["PERSON", "EMAIL_ADDRESS"])
        mode: "block" to fail validation if PII found, "mask" to return masked text
        language: Language code (default: "en")
    
    Returns:
        Dictionary with validation result
    """
    try:
        # Initialize Presidio engines
        analyzer = build_analyzer()
        
        # Analyze text for PII
        results = analyzer.analyze(
            text=text,
            entities=entity_types if entity_types else None,  # None = detect all
            language=language
        )
        
        # Extract detected entities
        detected_entities = []
        for result in results:
            detected_entities.append({
                "type": result.entity_type,
                "start": result.start,
                "end": result.end,
                "score": result.score,
                "text": text[result.start:result.end]
            })
        
        # If no PII detected, validation passes
        if not results:
            return {
                "passed": True,
                "detectedEntities": [],
                "maskedText": None
            }
        
        # Block mode: fail validation if PII detected
        if mode == "block":
            entity_summary = {}
            for entity in detected_entities:
                entity_type = entity["type"]
                entity_summary[entity_type] = entity_summary.get(entity_type, 0) + 1
            
            summary_str = ", ".join([f"{count} {etype}" for etype, count in entity_summary.items()])
            
            return {
                "passed": False,
                "error": f"PII detected: {summary_str}",
                "detectedEntities": detected_entities,
                "maskedText": None
            }
        
        # Mask mode: anonymize PII and return masked text
        elif mode == "mask":
            anonymizer = AnonymizerEngine()
            
            # Use <ENTITY_TYPE> as the replacement pattern
            operators = {}
            for entity_type in set([r.entity_type for r in results]):
                operators[entity_type] = OperatorConfig("replace", {"new_value": f"<{entity_type}>"})
            
            anonymized_result = anonymizer.anonymize(
                text=text,
                analyzer_results=results,
                operators=operators
            )
            
            return {
                "passed": True,
                "detectedEntities": detected_entities,
                "maskedText": anonymized_result.text
            }
        
        else:
            return {
                "passed": False,
                "error": f"Invalid mode: {mode}. Must be 'block' or 'mask'",
                "detectedEntities": []
            }
            
    except Exception as e:
        return {
            "passed": False,
            "error": f"PII detection failed: {str(e)}",
            "detectedEntities": []
        }


def mask_batch(
    texts: List[str],
    entity_types: List[str],
    language: str = "en"
) -> Dict[str, Any]:
    """
    Mask PII across many strings in a single process, reusing one analyzer +
    anonymizer instance (engine construction loads the spaCy model and is the
    dominant cost). Returns masked text per input, in input order; strings with
    no detected PII are returned unchanged so callers can substitute directly.
    """
    analyzer = build_analyzer()
    anonymizer = AnonymizerEngine()
    entities = entity_types if entity_types else None

    results = []
    for text in texts:
        if not text:
            results.append({"maskedText": text})
            continue
        analyzer_results = analyzer.analyze(text=text, entities=entities, language=language)
        if not analyzer_results:
            results.append({"maskedText": text})
            continue
        operators = {
            entity_type: OperatorConfig("replace", {"new_value": f"<{entity_type}>"})
            for entity_type in set([r.entity_type for r in analyzer_results])
        }
        anonymized = anonymizer.anonymize(
            text=text,
            analyzer_results=analyzer_results,
            operators=operators
        )
        results.append({"maskedText": anonymized.text})

    return {"passed": True, "results": results}


def main():
    """Main entry point for CLI usage"""
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)

        entity_types = data.get("entityTypes", [])
        language = data.get("language", "en")

        # Batch mask mode: an array of texts processed with one warm engine pair.
        if "texts" in data:
            texts = data.get("texts", [])
            result = mask_batch(texts, entity_types, language)
            print(f"__SIM_RESULT__={json.dumps(result)}")
            return

        text = data.get("text", "")
        mode = data.get("mode", "block")

        # Validate inputs
        if not text:
            result = {
                "passed": False,
                "error": "No text provided",
                "detectedEntities": []
            }
        else:
            result = detect_pii(text, entity_types, mode, language)

        # Output result with marker for parsing
        print(f"__SIM_RESULT__={json.dumps(result)}")
        
    except json.JSONDecodeError as e:
        print(f"__SIM_RESULT__={json.dumps({
            'passed': False,
            'error': f'Invalid JSON input: {str(e)}',
            'detectedEntities': []
        })}")
    except Exception as e:
        print(f"__SIM_RESULT__={json.dumps({
            'passed': False,
            'error': f'Unexpected error: {str(e)}',
            'detectedEntities': []
        })}")


if __name__ == "__main__":
    main()

