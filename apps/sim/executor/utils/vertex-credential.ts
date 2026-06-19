import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { getServiceAccountToken, refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('VertexCredential')

/**
 * Resolves a Vertex AI OAuth credential to an access token.
 * Shared across agent, evaluator, and router handlers. Authorizes the executing
 * user against the credential first — workspace credentials are usable by their
 * members and by derived workspace admins, matching `authorizeCredentialUse`.
 */
export async function resolveVertexCredential(
  credentialId: string,
  actingUserId: string | undefined,
  callerLabel = 'vertex'
): Promise<string> {
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
  if (!access.hasWorkspaceAccess || (!access.member && !access.isAdmin)) {
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

  const accountRow = await db.query.account.findFirst({
    where: eq(account.id, cred.accountId),
  })

  if (!accountRow) {
    throw new Error(`Vertex AI credential not found: ${credentialId}`)
  }

  const { accessToken } = await refreshTokenIfNeeded(requestId, accountRow, cred.accountId)

  if (!accessToken) {
    throw new Error('Failed to get Vertex AI access token')
  }

  logger.info(`[${requestId}] Successfully resolved Vertex AI credential`)
  return accessToken
}
