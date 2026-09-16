import Ajv, { type ValidateFunction } from 'ajv'
import Ajv2020 from 'ajv/dist/2020'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { McpToolSchema } from '@/lib/mcp/types'

/** Requires a synchronous, locally verifiable MCP input schema before exposure or execution. */
export function compileMcpToolSchema(schema: McpToolSchema): ValidateFunction {
  if (!schema || schema.type !== 'object') {
    throw new OrchestrationError('validation', 'MCP operation has no valid object input schema')
  }
  const Validator = schema.$schema === 'http://json-schema.org/draft-07/schema#' ? Ajv : Ajv2020
  try {
    const validate = new Validator({
      strict: false,
      validateFormats: false,
      allErrors: false,
    }).compile(schema)
    if ('$async' in validate && validate.$async)
      throw new Error('Asynchronous schemas are not supported')
    return validate
  } catch {
    throw new OrchestrationError('validation', 'MCP operation schema could not be validated')
  }
}
