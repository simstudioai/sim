import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { buildWebhookTriggerUrl } from '@/lib/webhooks/trigger-url'

const logger = createLogger('WebhookProviderSubscriptions')

/** Safely read a webhook row's provider config as a plain object. */
export function getProviderConfig(webhook: Record<string, unknown>): Record<string, unknown> {
  return toRecord(webhook.providerConfig)
}

/** Build the public callback URL providers should deliver webhook events to. */
export function getNotificationUrl(webhook: Record<string, unknown>): string {
  return buildWebhookTriggerUrl(String(webhook.path))
}

/**
 * Resolve an OAuth-backed credential to the owning user and account.
 *
 * Provider subscription handlers use this when they need to refresh tokens or
 * make provider API calls on behalf of the credential owner during webhook
 * registration and cleanup.
 */
export async function getCredentialOwner(
  credentialId: string,
  requestId: string
): Promise<{ userId: string; accountId: string } | null> {
  const resolved = await resolveOAuthAccountId(credentialId)
  if (!resolved) {
    logger.warn(`[${requestId}] Failed to resolve OAuth account for credentialId ${credentialId}`)
    return null
  }
  const [credentialRecord] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(eq(account.id, resolved.accountId))
    .limit(1)

  if (!credentialRecord?.userId) {
    logger.warn(`[${requestId}] Credential owner not found for credentialId ${credentialId}`)
    return null
  }

  return { userId: credentialRecord.userId, accountId: resolved.accountId }
}

/**
 * Resolve an OAuth-backed credential to a fresh access token for its owner.
 *
 * Returns null when the credential's owner cannot be resolved or no token is
 * available, leaving the caller to decide whether that is fatal.
 */
export async function getCredentialAccessToken(
  credentialId: string,
  requestId: string
): Promise<string | null> {
  const owner = await getCredentialOwner(credentialId, requestId)
  return owner ? refreshAccessTokenIfNeeded(owner.accountId, owner.userId, requestId) : null
}
