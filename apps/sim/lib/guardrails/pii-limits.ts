/** Maximum characters accepted or returned by single-text PII validation. */
export const MAX_PII_VALIDATION_TEXT_CHARACTERS = 10_000_000

/** Maximum detected spans materialized into one guardrail verdict. */
export const MAX_PII_VALIDATION_DETECTED_ENTITIES = 10_000

/** Maximum bytes read or serialized for one PII validation result. */
export const MAX_PII_VALIDATION_RESPONSE_BYTES = 10 * 1024 * 1024
