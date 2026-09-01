import { createLogger } from '@sim/logger'
import { AuthType } from '@/lib/auth/hybrid'
import { bindExecutorManagedOAuthDelegation } from '@/lib/credentials/application/managed-oauth-delegation'
import {
  type CredentialTokenPayload,
  resolveCredentialAccessToken,
} from '@/lib/oauth/token-resolution'
import type { ExecutorDelegationOrigin } from '@/executor/types'

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
  /** Proves managed-credential delegations in-process when the run carries one. */
  executorDelegationOrigin?: ExecutorDelegationOrigin
}

/**
 * Resolves a credential's access token in-process for server-side workflow
 * execution. Goes through the same authorized application dispatch as
 * `POST /api/auth/oauth/token` (`resolveCredentialAccessToken`), replacing the
 * HTTP hop the executor used to make to its own route — both runtimes hold the
 * OAuth client config the refresh branch needs, so authorization, refresh, and
 * audit run identically without the round trip.
 */
export async function resolveExecutorCredentialToken(
  params: ResolveExecutorCredentialTokenParams
): Promise<CredentialTokenPayload> {
  const { requestId, credentialId, userId, workflowId, toolId, executorDelegationOrigin } = params

  if (executorDelegationOrigin && !executorDelegationOrigin.currentWorkflow) {
    throw new Error('Managed credential delegation is missing current workflow authority')
  }

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
      ...(userId ? { userId } : {}),
      authType: AuthType.INTERNAL_JWT,
    }),
    ...(executorDelegationOrigin
      ? {
          resolveManagedPrincipal: (managedCredentialId: string) =>
            bindExecutorManagedOAuthDelegation(executorDelegationOrigin, managedCredentialId),
        }
      : {}),
  })

  if (!result.ok) {
    logger.error(`[${requestId}] Credential token resolution failed`, {
      status: result.status,
      credentialId,
      ...(result.code ? { code: result.code } : {}),
    })
    throw new Error(
      `Failed to obtain credential for ${params.toolLabel ?? credentialId}: ${result.error}`
    )
  }

  return result.token
}
