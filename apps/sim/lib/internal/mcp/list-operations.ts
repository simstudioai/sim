import { isPlainRecord } from '@sim/utils/object'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const listMcpOperations: InternalToolOperationHandler = async (request) => {
  const input = request.input
  if (
    !isPlainRecord(input) ||
    typeof input.server !== 'string' ||
    !input.server.trim() ||
    input.server.length > 256
  ) {
    throw new Error('MCP server is required')
  }
  if (!request.context.workspaceId) throw new Error('MCP discovery requires a workspace')
  const limit = input.limit ?? 100
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('MCP page size must be between 1 and 100')
  if (
    input.search !== undefined &&
    (typeof input.search !== 'string' || input.search.length > 1000)
  )
    throw new Error('Invalid MCP search')
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 256))
    throw new Error('Invalid MCP cursor')
  if (
    input.connection !== undefined &&
    (typeof input.connection !== 'string' || !input.connection.trim())
  )
    throw new Error('Invalid managed connection')
  const connection =
    typeof input.connection === 'string' && input.connection ? input.connection : undefined
  const tools = await discoverMcpServerToolsAsExecutor({
    workspaceId: request.context.workspaceId,
    context: request.context,
    serverId: connection ?? input.server,
    assertedServerId: connection ? input.server : undefined,
    signal: request.signal,
  })
  const search = typeof input.search === 'string' ? input.search.toLowerCase() : ''
  const filtered = tools
    .filter((tool) => `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(search))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const remaining = filtered.filter((tool) => !input.cursor || tool.name > String(input.cursor))
  const operations = remaining.slice(0, limit).map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    serverId: tool.canonicalServerId ?? tool.serverId,
  }))
  const hasMore = remaining.length > limit
  return Response.json({
    success: true,
    output: { operations, hasMore, nextCursor: hasMore ? operations.at(-1)!.name : null },
  })
}
