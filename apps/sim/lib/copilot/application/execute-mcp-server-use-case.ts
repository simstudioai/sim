import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/copilot/auth/application-delegation'
import { mcpServerDelegationPolicy } from '@/lib/mcp/application/authorization'
import { mcpServerOperations } from '@/lib/mcp/application/operations'

export const executeCopilotMcpServerUseCase = createCopilotApplicationAdapter({
  domain: 'MCP server',
  delegation: {
    audience: mcpServerDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: mcpServerOperations,
})
