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
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig
except ImportError:
    print(json.dumps({
        "passed": False,
        "error": "Presidio not installed. Run: pip install presidio-analyzer presidio-anonymizer",
        "detectedEntities": []
    }))
    sys.exit(0)


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
        analyzer = AnalyzerEngine()
        
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


def main():
    """Main entry point for CLI usage"""
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        
        text = data.get("text", "")
        entity_types = data.get("entityTypes", [])
        mode = data.get("mode", "block")
        language = data.get("language", "en")
        
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

