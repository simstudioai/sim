import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { TOOL_RUNTIME_SCHEMAS } from '@/lib/copilot/generated/tool-schemas-v1'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const ajv = new Ajv({
  allErrors: true,
  strict: false,
})

const validatorCache = new Map<string, ValidateFunction>()

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'unknown validation error'
  return errors
    .slice(0, 5)
    .map((error) => `${error.instancePath || '/'} ${error.message || 'is invalid'}`.trim())
    .join('; ')
}

function getValidator(
  toolName: string,
  schemaKind: 'parameters' | 'resultSchema'
): ValidateFunction | null {
  const cacheKey = `${toolName}:${schemaKind}`
  const cached = validatorCache.get(cacheKey)
  if (cached) return cached

  const schema = TOOL_RUNTIME_SCHEMAS[toolName]?.[schemaKind]
  if (!schema) return null

  const validator = ajv.compile(schema as object)
  validatorCache.set(cacheKey, validator)
  return validator
}

export function validateGeneratedToolPayload<T>(
  toolName: string,
  schemaKind: 'parameters' | 'resultSchema',
  payload: T
): T {
  const validator = getValidator(toolName, schemaKind)
  if (!validator) return payload

  if (!validator(payload)) {
    const label = schemaKind === 'parameters' ? 'input' : 'output'
    const message = `${toolName} ${label} validation failed: ${formatErrors(validator.errors)}`
    // Input validation is the CALLER's mistake — classified, so the copilot
    // error projection surfaces it verbatim and the model can fix its
    // arguments instead of blind-retrying a masked "system error". Output
    // validation failing is the tool's own bug and stays internal.
    if (schemaKind === 'parameters') throw new OrchestrationError('validation', message)
    throw new Error(message)
  }

  return payload
}
