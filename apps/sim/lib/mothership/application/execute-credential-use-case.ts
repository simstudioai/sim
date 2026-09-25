import { CREDENTIAL_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { createCopilotApplicationAdapter } from '@/lib/mothership/application/application-adapter'
import { COPILOT_APPLICATION_DELEGATION_TTL_MS } from '@/lib/mothership/auth/application-delegation'

export const executeCopilotCredentialUseCase = createCopilotApplicationAdapter({
  domain: 'credential',
  delegation: {
    audience: CREDENTIAL_DELEGATION_AUDIENCE,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (context) => `copilot-tool:${context.toolCallId}`,
  },
  operations: credentialOperations,
})
