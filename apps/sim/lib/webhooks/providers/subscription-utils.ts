import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProviderSubscriptions')

export function getProviderConfig(webhook: Record<string, unknown>): Record<string, unknown> {
  return (webhook.providerConfig as Record<string, unknown>) || {}
}

export function getNotificationUrl(webhook: Record<string, unknown>): string {
  return `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`
}

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
