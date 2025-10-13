import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import {
  BaseSubscriptionManager,
  type SubscriptionOperationResult,
  type WebhookData,
  type WorkflowData,
} from './types'

const logger = createLogger('TeamsSubscriptionManager')

/**
 * Manages Microsoft Teams chat subscriptions via Microsoft Graph API
 *
 * Creates, renews, and deletes Graph change notification subscriptions
 * for Teams chat messages.
 */
export class TeamsChatSubscriptionManager extends BaseSubscriptionManager {
  readonly id = 'microsoftteams_chat'

  canHandle(webhook: WebhookData): boolean {
    const config = webhook.providerConfig as Record<string, unknown>
    return (
      webhook.provider === 'microsoftteams' &&
      config.triggerId === 'microsoftteams_chat_subscription'
    )
  }

  async create(
    request: NextRequest,
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const credentialId = config.credentialId as string | undefined
      const chatId = config.chatId as string | undefined
      const subscriptionScope = (config.subscriptionScope as string) || 'chat'

      if (!credentialId) {
        logger.warn(`[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`)
        return { success: false, error: 'Missing credentialId' }
      }

      // Get access token
      const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`
        )
        return { success: false, error: 'Failed to get access token' }
      }

      // Check if subscription already exists
      const existingSubscriptionId = config.externalSubscriptionId as string | undefined
      if (existingSubscriptionId) {
        try {
          const checkRes = await fetch(
            `https://graph.microsoft.com/v1.0/subscriptions/${existingSubscriptionId}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          )
          if (checkRes.ok) {
            const existing = await checkRes.json()
            logger.info(
              `[${requestId}] Teams subscription ${existingSubscriptionId} already exists for webhook ${webhook.id}`
            )
            return {
              success: true,
              externalId: existing.id,
              expiresAt: new Date(existing.expirationDateTime),
            }
          }
        } catch (err) {
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
        logger.error(
          `[${requestId}] Cannot determine resource for Teams subscription ${webhook.id}`
        )
        return { success: false, error: 'Missing chatId or invalid scope' }
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
        logger.error(
          `[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`,
          {
            status: res.status,
            error: payload.error,
          }
        )
        return { success: false, error: payload.error?.message || 'Failed to create subscription' }
      }

      // Persist the external subscription ID and expiration
      await this.persistConfig(webhook.id, {
        externalSubscriptionId: payload.id,
        subscriptionExpiration: payload.expirationDateTime,
      })

      logger.info(
        `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
      )

      return {
        success: true,
        externalId: payload.id,
        expiresAt: new Date(payload.expirationDateTime),
      }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error creating Teams subscription for webhook ${webhook.id}`,
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async renew(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const externalSubscriptionId = config.externalSubscriptionId as string | undefined
      const credentialId = config.credentialId as string | undefined

      if (!externalSubscriptionId || !credentialId) {
        logger.warn(
          `[${requestId}] Missing subscription ID or credential for renewal of webhook ${webhook.id}`
        )
        return { success: false, error: 'Missing subscription ID or credential' }
      }

      // Get access token
      const accessToken = await refreshAccessTokenIfNeeded(
        credentialId,
        workflow.userId,
        `renewal-${webhook.id}`
      )
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to get access token for renewal of webhook ${webhook.id}`
        )
        return { success: false, error: 'Failed to get access token' }
      }

      // Extend expiration to max lifetime
      const maxLifetimeMinutes = 4230
      const newExpirationDateTime = new Date(
        Date.now() + maxLifetimeMinutes * 60 * 1000
      ).toISOString()

      const res = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExpirationDateTime }),
        }
      )

      if (!res.ok) {
        const error = await res.json()
        logger.error(
          `[${requestId}] Failed to renew Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`,
          { status: res.status, error: error.error }
        )

        // If subscription not found, try to recreate
        if (res.status === 404) {
          logger.info(
            `[${requestId}] Subscription not found, attempting to recreate for webhook ${webhook.id}`
          )
          return await this.recreate(webhook, workflow, accessToken, requestId)
        }

        return { success: false, error: error.error?.message || 'Failed to renew subscription' }
      }

      const payload = await res.json()

      // Persist new expiration
      await this.persistConfig(webhook.id, {
        subscriptionExpiration: payload.expirationDateTime,
      })

      logger.info(
        `[${requestId}] Successfully renewed Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. New expiration: ${payload.expirationDateTime}`
      )

      return {
        success: true,
        externalId: externalSubscriptionId,
        expiresAt: new Date(payload.expirationDateTime),
      }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error renewing Teams subscription for webhook ${webhook.id}`,
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async delete(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const externalSubscriptionId = config.externalSubscriptionId as string | undefined
      const credentialId = config.credentialId as string | undefined

      if (!externalSubscriptionId || !credentialId) {
        logger.info(`[${requestId}] No external subscription to delete for webhook ${webhook.id}`)
        return { success: true }
      }

      // Get access token
      const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
      if (!accessToken) {
        logger.warn(
          `[${requestId}] Could not get access token to delete Teams subscription for webhook ${webhook.id}`
        )
        // Don't fail deletion if we can't clean up
        return { success: true, error: 'Could not get access token, subscription may still exist' }
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
          `[${requestId}] Successfully deleted Teams subscription ${externalSubscriptionId} for webhook ${webhook.id} (status: ${res.status})`
        )
        return { success: true }
      }

      const errorBody = await res.text()
      logger.warn(
        `[${requestId}] Failed to delete Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}. Status: ${res.status}, Error: ${errorBody}`
      )
      // Don't fail webhook deletion if subscription cleanup fails
      return { success: true, error: `Failed to delete subscription: ${errorBody}` }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error deleting Teams subscription for webhook ${webhook.id}`,
        error
      )
      // Don't fail webhook deletion if cleanup fails
      return { success: true, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Recreate a subscription if the original was deleted
   */
  private async recreate(
    webhook: WebhookData,
    workflow: WorkflowData,
    accessToken: string,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const chatId = config.chatId as string | undefined
      const subscriptionScope = (config.subscriptionScope as string) || 'chat'

      const notificationUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/trigger/${webhook.path}`
      const resource =
        subscriptionScope === 'all-chats'
          ? '/chats/getAllMessages'
          : chatId
            ? `/chats/${encodeURIComponent(chatId)}/messages`
            : null

      if (!resource) {
        logger.error(
          `[${requestId}] Cannot recreate subscription: missing chat ID for webhook ${webhook.id}`
        )
        return { success: false, error: 'Missing chatId for recreation' }
      }

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
        logger.error(
          `[${requestId}] Failed to recreate Teams subscription for webhook ${webhook.id}`,
          {
            status: res.status,
            error: payload.error,
          }
        )
        return {
          success: false,
          error: payload.error?.message || 'Failed to recreate subscription',
        }
      }

      // Update with new subscription ID
      await this.persistConfig(webhook.id, {
        externalSubscriptionId: payload.id,
        subscriptionExpiration: payload.expirationDateTime,
      })

      logger.info(
        `[${requestId}] Recreated Teams subscription ${payload.id} for webhook ${webhook.id}`
      )

      return {
        success: true,
        externalId: payload.id,
        expiresAt: new Date(payload.expirationDateTime),
      }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error recreating Teams subscription for webhook ${webhook.id}`,
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
