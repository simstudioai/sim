import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  getServiceAccountToken,
  refreshTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/lib/oauth/credential-service'

const logger = createLogger('LlmCredentials')

/** Resolves an already-authorized Vertex credential into a provider access token. */
export async function resolveVertexAccessToken(
  requestId: string,
  credentialId: string
): Promise<string> {
  logger.info(`[${requestId}] Resolving Vertex AI credential`, { credentialId })

  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) throw new Error(`Vertex AI credential not found: ${credentialId}`)

  if (resolved.credentialType === 'service_account' && resolved.credentialId) {
    const accessToken = await getServiceAccountToken(resolved.credentialId, [
      'https://www.googleapis.com/auth/cloud-platform',
    ])
    logger.info(`[${requestId}] Resolved Vertex AI service account credential`)
    return accessToken
  }

  const credential = await db.query.account.findFirst({
    where: eq(account.id, resolved.accountId),
  })
  if (!credential) throw new Error(`Vertex AI credential not found: ${credentialId}`)

  const { accessToken } = await refreshTokenIfNeeded(requestId, credential, resolved.accountId)
  if (!accessToken) throw new Error('Failed to get Vertex AI access token')

  logger.info(`[${requestId}] Resolved Vertex AI credential`)
  return accessToken
}
