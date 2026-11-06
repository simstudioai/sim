import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** A tool result the model reads as a failure it can act on. */
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** A JSON object as text and as `structuredContent`, for a tool that declares an output schema. */
export function structuredToolResult(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
}
