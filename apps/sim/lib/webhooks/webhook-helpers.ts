import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const teamsLogger = createLogger('TeamsSubscription')
const telegramLogger = createLogger('TelegramWebhook')
const airtableLogger = createLogger('AirtableWebhook')

/**
 * Create a Microsoft Teams chat subscription
 * Returns true if successful, false otherwise
 */
export async function createTeamsSubscription(
  request: NextRequest,
  webhook: any,
  workflow: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return true // Not a Teams subscription, no action needed
    }

    const credentialId = config.credentialId as string | undefined
    const chatId = config.chatId as string | undefined

    if (!credentialId) {
      teamsLogger.warn(
        `[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`
      )
      return false
    }

    if (!chatId) {
      teamsLogger.warn(`[${requestId}] Missing chatId for Teams chat subscription ${webhook.id}`)
      return false
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.error(
        `[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`
      )
      return false
    }

    // Check if subscription already exists
    const existingSubscriptionId = config.externalSubscriptionId as string | undefined
    if (existingSubscriptionId) {
      try {
        const checkRes = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${existingSubscriptionId}`,
          { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (checkRes.ok) {
          teamsLogger.info(
            `[${requestId}] Teams subscription ${existingSubscriptionId} already exists for webhook ${webhook.id}`
          )
          return true
        }
      } catch {
        teamsLogger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
      }
    }

    // Build notification URL
    // Always use NEXT_PUBLIC_APP_URL to ensure Microsoft Graph can reach the public endpoint
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    // Subscribe to the specified chat
    const resource = `/chats/${chatId}/messages`

    // Create subscription with max lifetime (4230 minutes = ~3 days)
    const maxLifetimeMinutes = 4230
    const expirationDateTime = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString()

    const body = {
      changeType: 'created,updated',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource,
      includeResourceData: false,
      expirationDateTime,
      clientState: webhook.id,
    }

    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = await res.json()
    if (!res.ok) {
      teamsLogger.error(
        `[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`,
        {
          status: res.status,
          error: payload.error,
        }
      )
      return false
    }

    // Update webhook config with subscription details
    const updatedConfig = {
      ...config,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }

    await db
      .update(webhookTable)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhookTable.id, webhook.id))

    teamsLogger.info(
      `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error creating Teams subscription for webhook ${webhook.id}`,
      error
    )
    return false
  }
}

/**
 * Delete a Microsoft Teams chat subscription
 * Always returns true (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTeamsSubscription(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    // Only handle Teams chat subscriptions
    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return // Not a Teams subscription, no action needed
    }

    const externalSubscriptionId = config.externalSubscriptionId as string | undefined
    const credentialId = config.credentialId as string | undefined

    if (!externalSubscriptionId || !credentialId) {
      teamsLogger.info(
        `[${requestId}] No external subscription to delete for webhook ${webhook.id}`
      )
      return
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.warn(
        `[${requestId}] Could not get access token to delete Teams subscription for webhook ${webhook.id}`
      )
      return // Don't fail deletion
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (res.ok || res.status === 404) {
      teamsLogger.info(
        `[${requestId}] Successfully deleted Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`
      )
    } else {
      const errorBody = await res.text()
      teamsLogger.warn(
        `[${requestId}] Failed to delete Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. Status: ${res.status}`
      )
    }
  } catch (error) {
    teamsLogger.error(
      `[${requestId}] Error deleting Teams subscription for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}

/**
 * Create a Telegram bot webhook
 * Returns true if successful, false otherwise
 */
export async function createTelegramWebhook(
  request: NextRequest,
  webhook: any,
  requestId: string
): Promise<boolean> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(`[${requestId}] Missing botToken for Telegram webhook ${webhook.id}`)
      return false
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0',
      },
      body: JSON.stringify({ url: notificationUrl }),
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
      return false
    }

    telegramLogger.info(
      `[${requestId}] Successfully created Telegram webhook for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error creating Telegram webhook for webhook ${webhook.id}`,
      error
    )
    return false
  }
}

/**
 * Delete a Telegram bot webhook
 * Always returns void (don't fail webhook deletion if cleanup fails)
 */
export async function deleteTelegramWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      telegramLogger.warn(
        `[${requestId}] Missing botToken for Telegram webhook deletion ${webhook.id}`
      )
      return
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    const responseBody = await telegramResponse.json()
    if (!telegramResponse.ok || !responseBody.ok) {
      const errorMessage =
        responseBody.description ||
        `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
      telegramLogger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
    } else {
      telegramLogger.info(
        `[${requestId}] Successfully deleted Telegram webhook for webhook ${webhook.id}`
      )
    }
  } catch (error) {
    telegramLogger.error(
      `[${requestId}] Error deleting Telegram webhook for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}

/**
 * Delete an Airtable webhook
 * Always returns void (don't fail webhook deletion if cleanup fails)
 */
export async function deleteAirtableWebhook(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = (webhook.providerConfig as Record<string, any>) || {}
    const { baseId, externalId } = config as {
      baseId?: string
      externalId?: string
    }

    if (!baseId) {
      airtableLogger.warn(`[${requestId}] Missing baseId for Airtable webhook deletion`, {
        webhookId: webhook.id,
      })
      return
    }

    const userIdForToken = workflow.userId
    const accessToken = await getOAuthToken(userIdForToken, 'airtable')
    if (!accessToken) {
      airtableLogger.warn(
        `[${requestId}] Could not retrieve Airtable access token for user ${userIdForToken}. Cannot delete webhook in Airtable.`,
        { webhookId: webhook.id }
      )
      return
    }

    // Resolve externalId if missing by listing webhooks and matching our notificationUrl
    let resolvedExternalId: string | undefined = externalId

    if (!resolvedExternalId) {
      try {
        const expectedNotificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`

        const listUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`
        const listResp = await fetch(listUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })
        const listBody = await listResp.json().catch(() => null)

        if (listResp.ok && listBody && Array.isArray(listBody.webhooks)) {
          const match = listBody.webhooks.find((w: any) => {
            const url: string | undefined = w?.notificationUrl
            if (!url) return false
            return (
              url === expectedNotificationUrl ||
              url.endsWith(`/api/webhooks/trigger/${webhook.path}`)
            )
          })
          if (match?.id) {
            resolvedExternalId = match.id as string
            airtableLogger.info(`[${requestId}] Resolved Airtable externalId by listing webhooks`, {
              baseId,
              externalId: resolvedExternalId,
            })
          } else {
            airtableLogger.warn(`[${requestId}] Could not resolve Airtable externalId from list`, {
              baseId,
              expectedNotificationUrl,
            })
          }
        } else {
          airtableLogger.warn(
            `[${requestId}] Failed to list Airtable webhooks to resolve externalId`,
            {
              baseId,
              status: listResp.status,
              body: listBody,
            }
          )
        }
      } catch (e: any) {
        airtableLogger.warn(`[${requestId}] Error attempting to resolve Airtable externalId`, {
          error: e?.message,
        })
      }
    }

    // If still not resolvable, skip remote deletion
    if (!resolvedExternalId) {
      airtableLogger.info(
        `[${requestId}] Airtable externalId not found; skipping remote deletion`,
        { baseId }
      )
      return
    }

    const airtableDeleteUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks/${resolvedExternalId}`
    const airtableResponse = await fetch(airtableDeleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!airtableResponse.ok) {
      let responseBody: any = null
      try {
        responseBody = await airtableResponse.json()
      } catch {
        // ignore parse errors
      }

      airtableLogger.warn(
        `[${requestId}] Failed to delete Airtable webhook in Airtable. Status: ${airtableResponse.status}`,
        { baseId, externalId: resolvedExternalId, response: responseBody }
      )
    } else {
      airtableLogger.info(`[${requestId}] Successfully deleted Airtable webhook in Airtable`, {
        baseId,
        externalId: resolvedExternalId,
      })
    }
  } catch (error: any) {
    airtableLogger.error(`[${requestId}] Error deleting Airtable webhook`, {
      webhookId: webhook.id,
      error: error.message,
      stack: error.stack,
    })
    // Don't fail webhook deletion
  }
}

/**
 * Clean up external webhook subscriptions for a webhook
 * This handles Airtable, Teams, and Telegram cleanup
 * Always returns void (don't fail deletion if cleanup fails)
 */
export async function cleanupExternalWebhook(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  if (webhook.provider === 'airtable') {
    await deleteAirtableWebhook(webhook, workflow, requestId)
  } else if (webhook.provider === 'microsoftteams') {
    await deleteTeamsSubscription(webhook, workflow, requestId)
  } else if (webhook.provider === 'telegram') {
    await deleteTelegramWebhook(webhook, requestId)
  }
}
