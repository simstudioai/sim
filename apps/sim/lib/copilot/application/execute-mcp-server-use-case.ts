import { createCopilotWorkspaceUseCaseExecutor } from '@/lib/copilot/application/execute-workspace-use-case'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { mcpServerOperations } from '@/lib/mcp/application/operations'

export const executeCopilotMcpServerUseCase = createCopilotWorkspaceUseCaseExecutor({
  audience: MCP_SERVER_DELEGATION_AUDIENCE,
  operations: mcpServerOperations,
})
