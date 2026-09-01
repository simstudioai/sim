import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { getCredentialOwner } from '@/lib/webhooks/provider-subscription-utils'
import type {
  FormatInputContext,
  FormatInputResult,
  PollingConfigContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Gmail')

export const gmailHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'email' in b) {
      return { input: { email: b.email, timestamp: b.timestamp } }
    }
    return { input: b }
  },

  async configurePolling({
    webhook: webhookData,
    requestId,
    persistProviderConfig,
  }: PollingConfigContext) {
    logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

    try {
      const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
      const credentialId = providerConfig.credentialId as string | undefined

      if (!credentialId) {
        logger.error(`[${requestId}] Missing credentialId for Gmail webhook ${webhookData.id}`)
        return false
      }

      const credentialOwner = await getCredentialOwner(credentialId, requestId)
      if (!credentialOwner) {
        logger.error(
          `[${requestId}] Could not resolve credential ${credentialId} for Gmail webhook ${webhookData.id}`
        )
        return false
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialOwner.accountId,
        credentialOwner.userId,
        requestId
      )
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to refresh/access Gmail token for credential ${credentialId}`
        )
        return false
      }

      const maxEmailsPerPoll =
        typeof providerConfig.maxEmailsPerPoll === 'string'
          ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
          : (providerConfig.maxEmailsPerPoll as number) || 25

      const pollingInterval =
        typeof providerConfig.pollingInterval === 'string'
          ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
          : (providerConfig.pollingInterval as number) || 5

      const now = new Date()

      const configuredProviderConfig = {
        ...providerConfig,
        userId: credentialOwner.userId,
        credentialId,
        maxEmailsPerPoll,
        pollingInterval,
        markAsRead: providerConfig.markAsRead || false,
        includeRawEmail: providerConfig.includeRawEmail || false,
        labelIds: providerConfig.labelIds || ['INBOX'],
        labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
        lastCheckedTimestamp: (providerConfig.lastCheckedTimestamp as string) || now.toISOString(),
        setupCompleted: true,
      }
      if (persistProviderConfig) {
        await persistProviderConfig(configuredProviderConfig)
      } else {
        await db
          .update(webhook)
          .set({ providerConfig: configuredProviderConfig, updatedAt: now })
          .where(eq(webhook.id, webhookData.id as string))
      }

      logger.info(
        `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
      )
      return true
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Failed to configure Gmail polling`, {
        webhookId: webhookData.id,
        error: err.message,
        stack: err.stack,
      })
      return false
    }
  },
}
