import type { McpToolResult, McpToolSchema } from '@/lib/mcp/types'
import type { ToolResponse } from '@/tools/types'

export interface McpRunOperationParams {
  server: string
  tool: string
  arguments?: Record<string, unknown> | string
}

export interface McpListOperationsParams {
  server: string
  search?: string
  limit?: number
  cursor?: string
}

export interface McpRunOperationResponse extends ToolResponse {
  output: McpToolResult
}

export interface McpListOperationsResponse extends ToolResponse {
  output: {
    serverId: string
    operations: Array<{
      name: string
      description: string
      inputSchema: McpToolSchema
    }>
    hasMore: boolean
    nextCursor: string | null
  }
}
