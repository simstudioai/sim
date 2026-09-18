import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** A tool result the model reads as a failure it can act on. */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** A tool result carrying a JSON value as text. */
export function jsonToolResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
