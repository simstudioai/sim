import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/copilot/auth/application-delegation'
import { customToolDelegationPolicy } from '@/lib/custom-tools/application/authorization'
import { customToolOperations } from '@/lib/custom-tools/application/operations'

export const executeCopilotCustomToolUseCase = createCopilotApplicationAdapter({
  domain: 'custom tool',
  delegation: {
    audience: customToolDelegationPolicy.audience,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: customToolOperations,
})
