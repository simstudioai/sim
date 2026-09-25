import { dashboardOperations } from '@/lib/dashboards/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'

export const executeDashboardUseCase = createCopilotApplicationAdapter({
  domain: 'dashboards',
  operations: dashboardOperations,
  delegation: {
    audience: workspaceFileDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
})
