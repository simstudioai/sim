export const GENERATED_OPENAPI_SPEC_FILES = [
  'openapi-v2-files-audit.json',
  'openapi-v2-billing.json',
] as const

/**
 * These specifications have not yet migrated to code-first generation. They
 * remain subject to contract cross-checking, but the generator rejects them as
 * inputs and never merges their schemas or operations into generated output.
 */
export const LEGACY_OPENAPI_SPEC_FILES = [
  'openapi-v2-logs.json',
  'openapi-v2-workflows.json',
  'openapi-v2-tables.json',
  'openapi-v2-knowledge.json',
  'openapi-v2-resources.json',
] as const

export const OPENAPI_SPEC_FILES = [
  LEGACY_OPENAPI_SPEC_FILES[1],
  LEGACY_OPENAPI_SPEC_FILES[0],
  GENERATED_OPENAPI_SPEC_FILES[0],
  LEGACY_OPENAPI_SPEC_FILES[2],
  LEGACY_OPENAPI_SPEC_FILES[3],
  GENERATED_OPENAPI_SPEC_FILES[1],
  LEGACY_OPENAPI_SPEC_FILES[4],
] as const
