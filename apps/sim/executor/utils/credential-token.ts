import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { AuthType } from '@/lib/auth/hybrid'
import { bindExecutorManagedOAuthDelegation } from '@/lib/credentials/application/managed-oauth-delegation'
import {
  type CredentialTokenPayload,
  resolveCredentialAccessToken,
} from '@/lib/oauth/token-resolution'

const logger = createLogger('ExecutorCredentialToken')

export interface ResolveExecutorCredentialTokenParams {
  requestId: string
  credentialId: string
  userId?: string
  workflowId?: string
  /** Tool consuming the token; required by the managed-OAuth scope policy. */
  toolId?: string
  /** Display label for the thrown failure ("Failed to obtain credential for X: ..."). */
  toolLabel?: string
  scopes?: string[]
  impersonateEmail?: string
  /** Asserts the acting user alongside the credential lookup, mirroring the HTTP surface. */
  enforceCredentialAccess?: boolean
  /** Canonical runtime identity used to authorize managed credentials in-process. */
  principal?: WorkflowExecutionPrincipal
}

/**
 * Resolves a credential's access token in-process for server-side workflow
 * execution, through the same authorized application dispatch as
 * `POST /api/auth/oauth/token` (`resolveCredentialAccessToken`). Both runtimes
 * hold the OAuth client config the refresh branch needs, so authorization,
 * refresh, and audit run identically to the route.
 */
export async function resolveExecutorCredentialToken(
  params: ResolveExecutorCredentialTokenParams
): Promise<CredentialTokenPayload> {
  const { requestId, credentialId, userId, workflowId, toolId, principal } = params

  const result = await resolveCredentialAccessToken({
    requestId,
    credentialId,
    workflowId,
    toolId,
    scopes: params.scopes,
    impersonateEmail: params.impersonateEmail,
    callerUserId: userId && params.enforceCredentialAccess ? userId : undefined,
    authenticate: () => ({
      success: true,
      userId,
      authType: AuthType.INTERNAL_JWT,
    }),
    resolveManagedPrincipal: principal
      ? (managedCredentialId: string) =>
          bindExecutorManagedOAuthDelegation(principal, managedCredentialId)
      : undefined,
  })

  if (!result.ok) {
    logger.error(`[${requestId}] Credential token resolution failed`, {
      status: result.status,
      credentialId,
      code: result.code,
    })
    throw new Error(
      `Failed to obtain credential for ${params.toolLabel ?? credentialId}: ${result.error}`
    )
  }

  return result.token
}
