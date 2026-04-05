import { db } from '@sim/db'
import { account, webhook } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

/**
 * Configure Gmail polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureGmailPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('GmailWebhookSetup')
  logger.info(`[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

    if (!credentialId) {
      logger.error(`[${requestId}] Missing credentialId for Gmail webhook ${webhookData.id}`)
      return false
    }

    const resolvedGmail = await resolveOAuthAccountId(credentialId)
    if (!resolvedGmail) {
      logger.error(
        `[${requestId}] Could not resolve credential ${credentialId} for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const rows = await db
      .select()
      .from(account)
      .where(eq(account.id, resolvedGmail.accountId))
      .limit(1)
    if (rows.length === 0) {
      logger.error(
        `[${requestId}] Credential ${credentialId} not found for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    const accessToken = await refreshAccessTokenIfNeeded(
      resolvedGmail.accountId,
      effectiveUserId,
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
        : providerConfig.maxEmailsPerPoll || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
        : providerConfig.pollingInterval || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId: effectiveUserId,
          credentialId,
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: providerConfig.lastCheckedTimestamp || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}

/**
 * Configure Outlook polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureOutlookPolling(
  webhookData: any,
  requestId: string
): Promise<boolean> {
  const logger = createLogger('OutlookWebhookSetup')
  logger.info(`[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId

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
              : providerConfig.maxEmailsPerPoll || 25,
          pollingInterval:
            typeof providerConfig.pollingInterval === 'string'
              ? Number.parseInt(providerConfig.pollingInterval, 10) || 5
              : providerConfig.pollingInterval || 5,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          folderIds: providerConfig.folderIds || ['inbox'],
          folderFilterBehavior: providerConfig.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp: providerConfig.lastCheckedTimestamp || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(
      `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure Outlook polling`, {
      webhookId: webhookData.id,
      error: error.message,
      stack: error.stack,
    })
    return false
  }
}

/**
 * Configure RSS polling for a webhook
 */
export async function configureRssPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('RssWebhookSetup')
  logger.info(`[${requestId}] Setting up RSS polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          lastCheckedTimestamp: now.toISOString(),
          lastSeenGuids: [],
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id))

    logger.info(`[${requestId}] Successfully configured RSS polling for webhook ${webhookData.id}`)
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure RSS polling`, {
      webhookId: webhookData.id,
      error: error.message,
    })
    return false
  }
}

/**
 * Configure IMAP polling for a webhook
 */
export async function configureImapPolling(webhookData: any, requestId: string): Promise<boolean> {
  const logger = createLogger('ImapWebhookSetup')
  logger.info(`[${requestId}] Setting up IMAP polling for webhook ${webhookData.id}`)

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
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
      .where(eq(webhook.id, webhookData.id))

    logger.info(`[${requestId}] Successfully configured IMAP polling for webhook ${webhookData.id}`)
    return true
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to configure IMAP polling`, {
      webhookId: webhookData.id,
      error: error.message,
    })
    return false
  }
}
