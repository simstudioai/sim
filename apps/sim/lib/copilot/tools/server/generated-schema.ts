import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import { TOOL_RUNTIME_SCHEMAS } from '@/lib/copilot/generated/tool-schemas-v1'

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
    throw new Error(`${toolName} ${label} validation failed: ${formatErrors(validator.errors)}`)
  }

  return payload
}
