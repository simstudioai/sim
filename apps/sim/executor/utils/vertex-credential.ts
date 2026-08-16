import { createLogger } from '@sim/logger'
import { canUseCredential, getCredentialActorContext } from '@/lib/credentials/access'
import { getServiceAccountToken } from '@/lib/oauth/credential-service'
import { fetchCredentialAccessToken } from '@/executor/utils/credential-token'

const logger = createLogger('VertexCredential')

export interface ResolveVertexCredentialParams {
  credentialId: string
  actingUserId: string | undefined
  /** Workspace of the executing workflow. The credential must belong to it. */
  workspaceId: string | null | undefined
  /** Pins the token request to this workflow's workspace. */
  workflowId?: string
  callerLabel?: string
}

/**
 * Resolves a Vertex AI OAuth credential to an access token.
 * Shared across agent, evaluator, and router handlers. Enforces the same two
 * predicates as `authorizeCredentialUse`: the executing user must be a member
 * (or derived workspace admin) of the credential, and the credential must belong
 * to the workspace the workflow is executing in.
 */
export async function resolveVertexCredential({
  credentialId,
  actingUserId,
  workspaceId,
  workflowId,
  callerLabel = 'vertex',
}: ResolveVertexCredentialParams): Promise<string> {
  const requestId = `${callerLabel}-${Date.now()}`

  logger.info(`[${requestId}] Resolving Vertex AI credential: ${credentialId}`)

  if (!actingUserId) {
    throw new Error('Vertex AI credential use requires an authenticated user')
  }

  const access = await getCredentialActorContext(credentialId, actingUserId)
  const cred = access.credential
  if (!cred) {
    throw new Error(`Vertex AI credential not found: ${credentialId}`)
  }
  if (workspaceId && cred.workspaceId !== workspaceId) {
    logger.warn(`[${requestId}] Vertex AI credential belongs to a different workspace`, {
      credentialId,
      executingWorkspaceId: workspaceId,
    })
    throw new Error('Credential is not accessible from this workflow workspace')
  }
  if (!canUseCredential(access)) {
    throw new Error('Not authorized to use this Vertex AI credential')
  }

  if (cred.type === 'service_account') {
    const accessToken = await getServiceAccountToken(cred.id, [
      'https://www.googleapis.com/auth/cloud-platform',
    ])
    logger.info(`[${requestId}] Successfully resolved Vertex AI service account credential`)
    return accessToken
  }

  if (cred.type !== 'oauth' || !cred.accountId) {
    throw new Error(`Vertex AI credential is not a valid OAuth credential: ${credentialId}`)
  }

  /**
   * Fetched from the app rather than refreshed here: this runs inside the Trigger.dev
   * worker, whose environment carries no OAuth client config, so an in-process refresh
   * throws once the stored access token expires. The service-account branch above needs
   * no such config and stays in-process.
   */
  const accessToken = await fetchCredentialAccessToken({
    requestId,
    credentialId,
    userId: actingUserId,
    workflowId,
  })

  if (!accessToken) {
    throw new Error('Failed to get Vertex AI access token')
  }

  logger.info(`[${requestId}] Successfully resolved Vertex AI credential`)
  return accessToken
}
