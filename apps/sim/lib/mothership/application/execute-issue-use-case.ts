import { issueOperations } from '@/lib/issues/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'

export const executeIssueUseCase = createCopilotApplicationAdapter({
  domain: 'issues',
  operations: issueOperations,
  delegation: {
    audience: 'sim:workspaces',
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
})
