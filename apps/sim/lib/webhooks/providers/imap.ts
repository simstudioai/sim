import { db } from '@sim/db'
import { webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  createSecureImapClient,
  hasImapEnvironmentReferences,
  normalizeLiteralImapConnection,
  resolveImapConnectionForActor,
} from '@/lib/imap/connection.server'
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

  async configurePolling({
    webhook: webhookData,
    requestId,
    userId,
    workspaceId,
    persistProviderConfig,
  }: PollingConfigContext) {
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

      const connection = providerConfig as {
        host: string
        username: string
        password: string
        port?: string | number
        secure?: boolean
      }
      const hasReferences = hasImapEnvironmentReferences(connection)
      const resolved = hasReferences
        ? await resolveImapConnectionForActor({
            connection,
            actorUserId: userId,
            workspaceId,
          })
        : normalizeLiteralImapConnection(connection)
      const client = await createSecureImapClient(resolved)
      client.close()

      const configuredProviderConfig = {
        ...providerConfig,
        port:
          providerConfig.port === undefined || providerConfig.port === ''
            ? '993'
            : providerConfig.port,
        secure:
          providerConfig.secure === undefined || providerConfig.secure === ''
            ? true
            : providerConfig.secure,
        mailbox: providerConfig.mailbox || 'INBOX',
        searchCriteria: providerConfig.searchCriteria || 'UNSEEN',
        markAsRead: providerConfig.markAsRead || false,
        includeAttachments: providerConfig.includeAttachments !== false,
        lastCheckedTimestamp: now.toISOString(),
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
        `[${requestId}] Successfully configured IMAP polling for webhook ${webhookData.id}`
      )
      return true
    } catch {
      logger.error(`[${requestId}] Failed to configure IMAP polling`, {
        webhookId: webhookData.id,
      })
      return false
    }
  },
}
