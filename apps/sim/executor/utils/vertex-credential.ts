import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { refreshTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('VertexCredential')

/**
 * Resolves a Vertex AI OAuth credential to an access token.
 * Shared across agent, evaluator, and router handlers.
 */
export async function resolveVertexCredential(
  credentialId: string,
  callerLabel = 'vertex'
): Promise<string> {
  const requestId = `${callerLabel}-${Date.now()}`

  logger.info(`[${requestId}] Resolving Vertex AI credential: ${credentialId}`)

  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    throw new Error(`Vertex AI credential is not a valid OAuth credential: ${credentialId}`)
  }

  const credential = await db.query.account.findFirst({
    where: eq(account.id, resolved.accountId),
  })

  if (!credential) {
    throw new Error(`Vertex AI credential not found: ${credentialId}`)
  }

  const { accessToken } = await refreshTokenIfNeeded(requestId, credential, resolved.accountId)

  if (!accessToken) {
    throw new Error('Failed to get Vertex AI access token')
  }

  logger.info(`[${requestId}] Successfully resolved Vertex AI credential`)
  return accessToken
}
