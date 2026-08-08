import { createCopilotWorkspaceUseCaseExecutor } from '@/lib/copilot/application/execute-workspace-use-case'
import { CUSTOM_TOOL_DELEGATION_AUDIENCE } from '@/lib/custom-tools/application/authorization'
import { customToolOperations } from '@/lib/custom-tools/application/operations'

export const executeCopilotCustomToolUseCase = createCopilotWorkspaceUseCaseExecutor({
  audience: CUSTOM_TOOL_DELEGATION_AUDIENCE,
  operations: customToolOperations,
})
