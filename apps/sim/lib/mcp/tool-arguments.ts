import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'

const logger = createLogger('McpToolArguments')

/** Params an MCP tool call carries for the run, never sent to the server as arguments. */
const MCP_SYSTEM_PARAMETERS = new Set([
  'operationPolicy',
  'serverId',
  'serverUrl',
  'toolName',
  'serverName',
  '_context',
  'envVars',
  'workflowVariables',
  'blockData',
  'blockNameMapping',
  '_toolSchema',
])

/**
 * The arguments an MCP tool call sends its server: an explicit `arguments` object (or JSON
 * string), else every param that is not the run's own. Null when they cannot be read.
 */
export function parseMcpToolArguments(input: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(input)) return null
  if (!Object.hasOwn(input, 'arguments')) {
    return Object.fromEntries(
      Object.entries(input).filter(([name]) => !MCP_SYSTEM_PARAMETERS.has(name))
    )
  }

  const value = input.arguments
  if (typeof value !== 'string') return isPlainRecord(value) ? value : null
  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainRecord(parsed) ? parsed : null
  } catch (error) {
    logger.warn('Failed to parse MCP arguments JSON', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      argumentsLength: value.length,
    })
    return null
  }
}
