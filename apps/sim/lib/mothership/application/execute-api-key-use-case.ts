import { apiKeyOperations } from '@/lib/api-key/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'

export const executeCopilotApiKeyUseCase = createCopilotApplicationAdapter({
  domain: 'API key',
  delegation: {
    audience: 'sim:api-keys',
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: apiKeyOperations,
})
