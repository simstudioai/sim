import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ApplicationOperation } from '@/lib/core/application'
import type { SearchMcpActivityInput } from '@/lib/knowledge/mcp/activity'
import { toolError } from '@/lib/mcp/tool-result'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const MAX_RESULT_BYTES = 1024 * 1024
/** The annotations of every read-only Search MCP tool. */
export const KNOWLEDGE_MCP_READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

/**
 * Runs one Search MCP tool call: rate limit, cancellation, error projection and activity. Handed
 * to every tool registration so each backend's tools share it.
 */
export type KnowledgeMcpToolRunner = (
  toolName: SearchMcpActivityInput['toolName'],
  operation: ApplicationOperation,
  toolSignal: AbortSignal,
  run: (registry: ResolvedSecretTraceRegistry, signal: AbortSignal) => Promise<CallToolResult>
) => Promise<CallToolResult>

/** A tool result projected for its resolved secrets and bounded in size. */
export function projectResult(
  value: unknown,
  registry: ResolvedSecretTraceRegistry
): CallToolResult {
  if (!registry.isComplete()) {
    return toolError(
      'Document secret provenance is unavailable. The content cannot be returned safely.'
    )
  }
  const projected = projectResolvedSecretModelContent(value, registry, MAX_RESULT_BYTES)
  if (!projected.safe) {
    return toolError('This result cannot be safely returned. Try a smaller result page.')
  }
  const text = JSON.stringify(projected.value)
  if (Buffer.byteLength(text) > MAX_RESULT_BYTES) {
    return toolError('Result is too large. Request fewer results or a smaller page.')
  }
  return { content: [{ type: 'text', text }] }
}
