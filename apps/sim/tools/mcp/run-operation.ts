import type { McpRunOperationParams, McpRunOperationResponse } from '@/tools/mcp/types'
import type { InternalToolConfig } from '@/tools/types'

export const mcpRunOperationTool: InternalToolConfig<
  McpRunOperationParams,
  McpRunOperationResponse
> = {
  id: 'mcp_run_operation',
  name: 'Run MCP operation',
  version: '1.0.0',
  description: 'Run an authorized MCP operation with its discovered input schema.',
  params: {
    server: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'MCP server or managed connection ID',
    },
    tool: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact MCP operation name',
    },
    arguments: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of operation arguments',
    },
  },
  operation: {
    input: (params) => ({
      server: params.server,
      tool: params.tool,
      arguments: params.arguments ?? {},
    }),
  },
  outputs: { content: { type: 'array', description: 'MCP response content' } },
}
