import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020'
import { computeActionSchemaHash, stableStringify } from '@/lib/apps/manifest'

const logger = createLogger('AppSchemaValidate')

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateSchema: false,
})

const validatorCache = new Map<string, ValidateFunction>()

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'invalid value'
  return errors
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`.trim())
    .join('; ')
}

function cacheKeyForSchema(prefix: string, schema: object): string {
  return `${prefix}:${createHash('sha256').update(stableStringify(schema)).digest('hex')}`
}

function getValidator(cacheKey: string, schema: object): ValidateFunction | null {
  const cached = validatorCache.get(cacheKey)
  if (cached) return cached
  try {
    const validator = ajv.compile(schema)
    validatorCache.set(cacheKey, validator)
    return validator
  } catch (error) {
    logger.warn('Failed to compile JSON Schema', { cacheKey, error })
    return null
  }
}

export type ActionIntegrityFields = {
  actionId: string
  workflowId: string
  deploymentVersionId: string
  inputSchema: unknown
  outputAllowlist: unknown
  executionPolicy: string
}

/**
 * Validate action input against the release/revision JSON Schema snapshot.
 * Ajv is keyed on canonical schema content.
 *
 * When `action` is provided we recompute schemaHash for observability only —
 * a mismatch must not block execution. Stored hashes from pre-canonical eras
 * (and jsonb key-order drift) otherwise false-fail published apps.
 */
export function validateAppActionInput(params: {
  schemaHash: string
  inputSchema: unknown
  input: Record<string, unknown>
  /** Full action row fields — optional integrity telemetry. */
  action?: ActionIntegrityFields
}): { ok: true } | { ok: false; message: string } {
  if (!params.schemaHash || params.inputSchema == null || typeof params.inputSchema !== 'object') {
    return { ok: false, message: 'Action schema is missing' }
  }

  if (params.action) {
    const expected = computeActionSchemaHash({
      actionId: params.action.actionId,
      workflowId: params.action.workflowId,
      deploymentVersionId: params.action.deploymentVersionId,
      inputSchema: params.action.inputSchema as Parameters<
        typeof computeActionSchemaHash
      >[0]['inputSchema'],
      outputAllowlist: params.action.outputAllowlist as Parameters<
        typeof computeActionSchemaHash
      >[0]['outputAllowlist'],
      executionPolicy: params.action.executionPolicy as 'sync' | 'async',
    })
    if (expected !== params.schemaHash) {
      logger.warn('Action schemaHash mismatch after load (continuing with Ajv)', {
        actionId: params.action.actionId,
        stored: params.schemaHash,
        recomputed: expected,
      })
    }
  }

  const schema = params.inputSchema as object
  const validator = getValidator(cacheKeyForSchema('input', schema), schema)
  if (!validator) {
    return { ok: false, message: 'Action schema is invalid' }
  }

  if (validator(params.input)) {
    return { ok: true }
  }

  return { ok: false, message: formatErrors(validator.errors) }
}

export type NamedOutputSchema = {
  key: string
  schema: unknown
}

/**
 * Validate each named projected output against its stored JSON Schema snapshot.
 * Fail closed when a schema is present but cannot be compiled.
 */
export function validateAppActionOutputs(params: {
  outputs: Record<string, unknown>
  outputSchemas: NamedOutputSchema[]
}): { ok: true } | { ok: false; message: string } {
  for (const entry of params.outputSchemas) {
    if (entry.schema == null || typeof entry.schema !== 'object') {
      return { ok: false, message: `Output schema missing for ${entry.key}` }
    }
    const key = cacheKeyForSchema(`output:${entry.key}`, entry.schema as object)
    const validator = getValidator(key, entry.schema as object)
    if (!validator) {
      return { ok: false, message: `Output schema invalid for ${entry.key}` }
    }
    if (!(entry.key in params.outputs)) {
      return { ok: false, message: `Missing projected output ${entry.key}` }
    }
    if (!validator(params.outputs[entry.key])) {
      return {
        ok: false,
        message: `Output ${entry.key}: ${formatErrors(validator.errors)}`,
      }
    }
  }
  return { ok: true }
}
