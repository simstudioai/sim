import { buildNotesOperations } from '@/lib/build-notes/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import { workflowDelegationPolicy } from '@/lib/workflows/application/authorization'

/**
 * Build notes are workflow use cases, so they take the workflow delegation: evaluation hands the
 * same principal to the workflow apply it dry-runs.
 */
export const executeBuildNotesUseCase = createCopilotApplicationAdapter({
  domain: 'build_notes',
  operations: buildNotesOperations,
  delegation: {
    audience: workflowDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
})
