import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type {
  FormatInputContext,
  FormatInputResult,
  PollingConfigContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Imap')

export const imapHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    if (b && typeof b === 'object' && 'email' in b) {
      return {
        input: {
          messageId: b.messageId,
          subject: b.subject,
          from: b.from,
          to: b.to,
          cc: b.cc,
          date: b.date,
          bodyText: b.bodyText,
          bodyHtml: b.bodyHtml,
          mailbox: b.mailbox,
          hasAttachments: b.hasAttachments,
          attachments: b.attachments,
          email: b.email,
          timestamp: b.timestamp,
        },
      }
    }
    return { input: b }
  },

  async configurePolling({ webhook: webhookData, requestId }: PollingConfigContext) {
    logger.info(`[${requestId}] Setting up IMAP polling for webhook ${webhookData.id}`)

    try {
      const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
      const now = new Date()

      if (!providerConfig.host || !providerConfig.username || !providerConfig.password) {
        logger.error(
          `[${requestId}] Missing required IMAP connection settings for webhook ${webhookData.id}`
        )
        return false
      }

      await db
        .update(webhook)
        .set({
          providerConfig: {
            ...providerConfig,
            port: providerConfig.port || '993',
            secure: providerConfig.secure !== false,
            mailbox: providerConfig.mailbox || 'INBOX',
            searchCriteria: providerConfig.searchCriteria || 'UNSEEN',
            markAsRead: providerConfig.markAsRead || false,
            includeAttachments: providerConfig.includeAttachments !== false,
            lastCheckedTimestamp: now.toISOString(),
            setupCompleted: true,
          },
          updatedAt: now,
        })
        .where(eq(webhook.id, webhookData.id as string))

      logger.info(
        `[${requestId}] Successfully configured IMAP polling for webhook ${webhookData.id}`
      )
      return true
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Failed to configure IMAP polling`, {
        webhookId: webhookData.id,
        error: err.message,
      })
      return false
    }
  },
}
