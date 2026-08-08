import { createCopilotWorkspaceUseCaseExecutor } from '@/lib/copilot/application/execute-workspace-use-case'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const executeCopilotWorkflowUseCase = createCopilotWorkspaceUseCaseExecutor({
  audience: WORKFLOW_DELEGATION_AUDIENCE,
  operations: workflowOperations,
})
