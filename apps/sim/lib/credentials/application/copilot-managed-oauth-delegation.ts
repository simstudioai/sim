import type { DelegatedPrincipal } from '@sim/auth/principal'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createCopilotApplicationPrincipal,
  requireTrustedCopilotExecutionContext,
} from '@/lib/copilot/auth/application-delegation'
import { MANAGED_OAUTH_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'

/**
 * The principal a Chat tool call presents for one managed credential: a copilot
 * delegation naming the signed-in user, scoped to that credential, with no
 * workflow. The credential-group authorization evaluates its actor statement
 * against this subject, so the person can use the credential they collected
 * under their own enrollment and nothing else.
 */
export function createCopilotManagedOAuthPrincipal(
  context: CopilotExecutionContext | undefined,
  credentialId: string
): DelegatedPrincipal {
  const trustedContext = requireTrustedCopilotExecutionContext(context)
  return createCopilotApplicationPrincipal(trustedContext, {
    audience: MANAGED_OAUTH_DELEGATION_AUDIENCE,
    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    createDelegationId: (trusted) => `copilot-tool:${trusted.toolCallId}`,
    resourceScope: { credentialId },
  })
}
