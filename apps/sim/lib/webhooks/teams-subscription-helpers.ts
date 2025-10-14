import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TeamsSubscription')

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
    const subscriptionScope = (config.subscriptionScope as string) || 'chat'

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`)
      return false
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`)
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
          logger.info(
            `[${requestId}] Teams subscription ${existingSubscriptionId} already exists for webhook ${webhook.id}`
          )
          return true
        }
      } catch {
        logger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
      }
    }

    // Build notification URL
    const requestOrigin = new URL(request.url).origin
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? env.NEXT_PUBLIC_APP_URL || requestOrigin
      : requestOrigin
    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${webhook.path}`

    // Determine resource based on scope
    const resource =
      subscriptionScope === 'all-chats'
        ? '/chats/getAllMessages'
        : chatId
          ? `/chats/${chatId}/messages`
          : null

    if (!resource) {
      logger.error(`[${requestId}] Cannot determine resource for Teams subscription ${webhook.id}`)
      return false
    }

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
      logger.error(`[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`, {
        status: res.status,
        error: payload.error,
      })
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

    logger.info(
      `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
    )
    return true
  } catch (error) {
    logger.error(
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
      logger.info(`[${requestId}] No external subscription to delete for webhook ${webhook.id}`)
      return
    }

    // Get access token
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      logger.warn(
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
      logger.info(
        `[${requestId}] Successfully deleted Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`
      )
    } else {
      const errorBody = await res.text()
      logger.warn(
        `[${requestId}] Failed to delete Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. Status: ${res.status}`
      )
    }
  } catch (error) {
    logger.error(
      `[${requestId}] Error deleting Teams subscription for webhook ${webhook.id}`,
      error
    )
    // Don't fail webhook deletion
  }
}
