import type { ToolInputRef } from './schemas'

/**
 * Identity of a `tool-input` entry, independent of its param values. Tool-scoped canonical-mode
 * keys are positional (`${toolIndex}:${canonicalId}`), so a mode write names the tool it was made
 * for and the server compares identities to refuse a write whose tool has since moved or been
 * removed by another editor.
 */
export type ToolInputIdentity = Record<string, string>

const TOOL_IDENTITY_FIELDS = ['type', 'operation', 'toolId', 'customToolId'] as const

const TOOL_IDENTITY_PARAM_FIELDS = ['serverId', 'toolName', 'workflowId'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the fields that say which tool an entry is: its type and operation, the custom tool or MCP
 * tool it references, and the server or workflow its params bind to. Param values a user edits are
 * excluded, so a pending param change never makes a mode write look stale.
 */
export function getToolInputIdentity(tool: unknown): ToolInputIdentity | null {
  if (!isRecord(tool) || typeof tool.type !== 'string') return null

  const identity: ToolInputIdentity = {}
  for (const field of TOOL_IDENTITY_FIELDS) {
    const value = tool[field]
    if (typeof value === 'string') identity[field] = value
  }

  const params = isRecord(tool.params) ? tool.params : {}
  for (const field of TOOL_IDENTITY_PARAM_FIELDS) {
    const value = params[field]
    if (typeof value === 'string') identity[`params.${field}`] = value
  }

  return identity
}

function readToolInputList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Whether a tool-scoped canonical-mode write still names the tool it was made for: its key must
 * point at `toolRef.toolIndex`, and that position must still hold a tool with the same identity.
 * The server checks the persisted list before applying the write, and each editor checks its own
 * list before applying a broadcast one.
 */
export function isToolInputRefCurrent(
  tools: unknown,
  canonicalId: string,
  toolRef: ToolInputRef
): boolean {
  if (!canonicalId.startsWith(`${toolRef.toolIndex}:`)) return false
  const list = readToolInputList(tools)
  return list !== null && isSameToolInputIdentity(list[toolRef.toolIndex], toolRef.identity)
}

export function isSameToolInputIdentity(tool: unknown, identity: ToolInputIdentity): boolean {
  const current = getToolInputIdentity(tool)
  if (!current) return false

  const fields = new Set([...Object.keys(current), ...Object.keys(identity)])
  for (const field of fields) {
    if (current[field] !== identity[field]) return false
  }
  return true
}
