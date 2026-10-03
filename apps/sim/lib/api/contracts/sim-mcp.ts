import { mcpJsonRpcMessageSchema } from '@/lib/api/contracts/mcp'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** The Sim MCP server: one stateless Streamable HTTP endpoint carrying JSON-RPC. */
export const simMcpContract = defineRouteContract({
  method: 'POST',
  path: '/api/mcp',
  body: mcpJsonRpcMessageSchema,
  response: { mode: 'json', schema: mcpJsonRpcMessageSchema },
})
