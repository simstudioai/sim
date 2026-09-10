import type { McpListOperationsParams, McpListOperationsResponse } from '@/tools/mcp/types'
import type { InternalToolConfig } from '@/tools/types'

export const mcpListOperationsTool: InternalToolConfig<
  McpListOperationsParams,
  McpListOperationsResponse
> = {
  id: 'mcp_list_operations',
  name: 'List MCP operations',
  version: '1.0.0',
  description:
    'Discover authorized MCP names, descriptions and input schemas without running operations.',
  params: {
    server: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MCP server or managed connection ID',
    },
    connection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional managed connection bound to the server',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter operation names and descriptions',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size from 1 to 100',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last operation name from the previous page',
    },
  },
  operation: {
    input: (params) => ({
      server: params.server,
      connection: params.connection,
      search: params.search,
      limit: params.limit,
      cursor: params.cursor,
    }),
  },
  outputs: {
    operations: {
      type: 'array',
      description: 'Authorized operations',
      items: {
        type: 'object',
        properties: {
          serverId: { type: 'string', description: 'Canonical MCP server identity' },
          name: { type: 'string', description: 'Exact operation name' },
          description: { type: 'string', description: 'Operation description' },
          inputSchema: { type: 'json', description: 'Provider-defined JSON Schema for arguments' },
        },
      },
    },
    nextCursor: { type: 'string', description: 'Next page cursor, or null' },
    hasMore: { type: 'boolean', description: 'Whether more operations are available' },
  },
}
