import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/copilot/auth/application-delegation'
import { sandboxDelegationPolicy } from '@/lib/sandboxes/application/authorization'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'

export const executeCopilotSandboxUseCase = createCopilotApplicationAdapter({
  domain: 'sandbox',
  delegation: {
    audience: sandboxDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: sandboxOperations,
})
