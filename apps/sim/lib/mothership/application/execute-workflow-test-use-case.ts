import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import { workflowTestOperations } from '@/lib/workflow-tests/application/operations'

export const executeWorkflowTestUseCase = createCopilotApplicationAdapter({
  domain: 'workflow_tests',
  operations: workflowTestOperations,
  delegation: {
    audience: 'sim:workspaces',
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
})
