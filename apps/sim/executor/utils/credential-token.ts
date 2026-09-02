import { createLogger } from '@sim/logger'
import { AuthType } from '@/lib/auth/hybrid'
import type { CopilotExecutionContext } from '@/lib/copilot/auth/application-delegation'
import { createCopilotManagedOAuthPrincipal } from '@/lib/credentials/application/copilot-managed-oauth-delegation'
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
  /**
   * The trusted Chat tool call this token is for, when there is no workflow
   * run: it proves the signed-in user's own Credential Group credential.
   */
  copilotExecutionContext?: CopilotExecutionContext
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
  const {
    requestId,
    credentialId,
    userId,
    workflowId,
    toolId,
    executorDelegationOrigin,
    copilotExecutionContext,
  } = params

  if (executorDelegationOrigin && !executorDelegationOrigin.currentWorkflow) {
    throw new Error('Managed credential delegation is missing current workflow authority')
  }

  const resolveManagedPrincipal = executorDelegationOrigin
    ? (managedCredentialId: string) =>
        bindExecutorManagedOAuthDelegation(executorDelegationOrigin, managedCredentialId)
    : copilotExecutionContext?.copilotToolExecution
      ? async (managedCredentialId: string) =>
          createCopilotManagedOAuthPrincipal(copilotExecutionContext, managedCredentialId)
      : undefined

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
    resolveManagedPrincipal,
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
