import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isJsonWithinByteLimit } from '@/lib/core/utils/bounded-json'
import type { ExecuteMcpToolResult } from '@/lib/mcp/application/execute-tool'
import { MCP_PRESENTATION_MAX_BYTES, MCP_PRESENTATION_MAX_ITEMS } from '@/lib/mcp/presentation'

const logger = createLogger('McpPresentationSnapshot')

/** Captures linked bytes within the authorized invocation before publishing its immutable result. */
export async function createMcpToolPresentation(
  presentation: NonNullable<ExecuteMcpToolResult['presentation']>,
  readResource: (uri: string, signal: AbortSignal) => Promise<ReadResourceResult>,
  signal?: AbortSignal
): Promise<NonNullable<ExecuteMcpToolResult['presentation']>> {
  try {
    if (
      presentation.result.content.length > MCP_PRESENTATION_MAX_ITEMS ||
      !isJsonWithinByteLimit(presentation, MCP_PRESENTATION_MAX_BYTES)
    )
      throw new OrchestrationError('payload_too_large', 'MCP presentation exceeds its limits')
    const resources: ReadResourceResult['contents'] = []
    const deadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])])
    for (const item of presentation.result.content) {
      if (item.type !== 'resource_link' || resources.some((resource) => resource.uri === item.uri))
        continue
      try {
        if (!item.uri || item.uri.length > 2048)
          throw new OrchestrationError('validation', 'Invalid MCP resource URI')
        deadline.throwIfAborted()
        const result = await readResource(item.uri, deadline)
        if (!isJsonWithinByteLimit(result, MCP_PRESENTATION_MAX_BYTES))
          throw new OrchestrationError('payload_too_large', 'MCP resource exceeds 12 MiB')
        const resource = result.contents.find((resource) => resource.uri === item.uri)
        if (!resource) throw new OrchestrationError('not_found', 'MCP linked resource not found')
        if (
          !isJsonWithinByteLimit(
            { ...presentation, resources: [...resources, resource] },
            MCP_PRESENTATION_MAX_BYTES
          )
        )
          throw new OrchestrationError('payload_too_large', 'MCP presentation exceeds 12 MiB')
        resources.push(resource)
      } catch {
        signal?.throwIfAborted()
        logger.warn('An MCP linked resource could not be captured')
        if (deadline.aborted) break
      }
    }
    return { ...presentation, resources }
  } catch {
    signal?.throwIfAborted()
    logger.warn('MCP tool completed but its linked resources could not be captured')
    return presentation
  }
}
