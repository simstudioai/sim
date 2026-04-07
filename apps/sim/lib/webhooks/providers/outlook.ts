import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type {
  FormatInputContext,
  FormatInputResult,
  PollingConfigContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebhookProvider:Outlook')

export const outlookHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'email' in b) {
      return { input: { email: b.email, timestamp: b.timestamp } }
    }
    return { input: b }
  },

  async configurePolling({ webhook: webhookData, requestId }: PollingConfigContext) {
    logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)

    try {
      const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
      const credentialId = providerConfig.credentialId as string | undefined

      if (!credentialId) {
        logger.error(`[${requestId}] Missing credentialId for Outlook webhook ${webhookData.id}`)
        return false
      }

      const resolvedOutlook = await resolveOAuthAccountId(credentialId)
      if (!resolvedOutlook) {
        logger.error(
          `[${requestId}] Could not resolve credential ${credentialId} for Outlook webhook ${webhookData.id}`
        )
        return false
      }

      const rows = await db
        .select()
        .from(account)
        .where(eq(account.id, resolvedOutlook.accountId))
        .limit(1)
      if (rows.length === 0) {
        logger.error(
          `[${requestId}] Credential ${credentialId} not found for Outlook webhook ${webhookData.id}`
        )
        return false
      }

      const effectiveUserId = rows[0].userId

      const accessToken = await refreshAccessTokenIfNeeded(
        resolvedOutlook.accountId,
        effectiveUserId,
        requestId
      )
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to refresh/access Outlook token for credential ${credentialId}`
        )
        return false
      }

      const now = new Date()

      await db
        .update(webhook)
        .set({
          providerConfig: {
            ...providerConfig,
            userId: effectiveUserId,
            credentialId,
            maxEmailsPerPoll:
              typeof providerConfig.maxEmailsPerPoll === 'string'
                ? Number.parseInt(providerConfig.maxEmailsPerPoll, 10) || 25
                : (providerConfig.maxEmailsPerPoll as number) || 25,
            pollingInterval:
              typeof providerConfig.pollingInterval === 'string'
                ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
                : (providerConfig.pollingInterval as number) || 5,
            markAsRead: providerConfig.markAsRead || false,
            includeRawEmail: providerConfig.includeRawEmail || false,
            folderIds: providerConfig.folderIds || ['inbox'],
            folderFilterBehavior: providerConfig.folderFilterBehavior || 'INCLUDE',
            lastCheckedTimestamp:
              (providerConfig.lastCheckedTimestamp as string) || now.toISOString(),
            setupCompleted: true,
          },
          updatedAt: now,
        })
        .where(eq(webhook.id, webhookData.id as string))

      logger.info(
        `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
      )
      return true
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Failed to configure Outlook polling`, {
        webhookId: webhookData.id,
        error: err.message,
        stack: err.stack,
      })
      return false
    }
  },
}
