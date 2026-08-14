import { createCopilotApplicationAdapter } from '@/lib/copilot/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/copilot/auth/application-delegation'
import { CREDENTIAL_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'

export const executeCopilotCredentialUseCase = createCopilotApplicationAdapter({
  domain: 'credential',
  delegation: {
    audience: CREDENTIAL_DELEGATION_AUDIENCE,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: credentialOperations,
})
