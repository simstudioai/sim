import { db } from '@sim/db'
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { task } from '@trigger.dev/sdk/v3'
import { and, eq, sql } from 'drizzle-orm'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TeamsSubscriptionRenewal')

/**
 * Background job to renew Microsoft Teams Graph API subscriptions before they expire.
 * Runs periodically to check for subscriptions expiring soon and renews them.
 */
export const renewTeamsSubscriptions = task({
  id: 'renew-teams-subscriptions',
  // Run every 2 days to catch subscriptions that expire in ~3 days
  run: async (_payload: Record<string, never>) => {
    logger.info('Starting Teams subscription renewal job')

    try {
      // Find all Microsoft Teams webhooks with chat subscriptions that expire soon
      // Check for subscriptions expiring within the next 24 hours
      const expirationThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      const webhooksWithWorkflows = await db
        .select({
          webhook: webhookTable,
          workflow: workflowTable,
        })
        .from(webhookTable)
        .innerJoin(workflowTable, eq(webhookTable.workflowId, workflowTable.id))
        .where(
          and(
            eq(webhookTable.provider, 'microsoftteams'),
            // Check if subscription expiration is approaching
            sql`${webhookTable.providerConfig}->>'subscriptionExpiration' < ${expirationThreshold}`,
            sql`${webhookTable.providerConfig}->>'triggerId' = 'microsoftteams_chat_subscription'`
          )
        )

      logger.info(`Found ${webhooksWithWorkflows.length} Teams subscriptions to renew`)

      let renewed = 0
      let failed = 0

      for (const { webhook, workflow } of webhooksWithWorkflows) {
        const providerConfig = (webhook.providerConfig as Record<string, any>) || {}
        const externalSubscriptionId = providerConfig.externalSubscriptionId
        const credentialId = providerConfig.credentialId
        const chatId = providerConfig.chatId
        const subscriptionScope = providerConfig.subscriptionScope || 'chat'

        if (!externalSubscriptionId || !credentialId) {
          logger.warn(
            `Webhook ${webhook.id} missing subscription ID or credential, skipping renewal`
          )
          failed++
          continue
        }

        try {
          logger.info(`Renewing subscription ${externalSubscriptionId} for webhook ${webhook.id}`)

          // Get fresh access token
          const accessToken = await refreshAccessTokenIfNeeded(
            credentialId,
            workflow.userId,
            `renewal-${webhook.id}`
          )
          if (!accessToken) {
            logger.error(`Could not get access token for webhook ${webhook.id}`)
            failed++
            continue
          }

          // Set new expiration to maximum allowed (4230 minutes = ~3 days)
          const maxLifetimeMinutes = 4230
          const newExpirationDateTime = new Date(
            Date.now() + maxLifetimeMinutes * 60 * 1000
          ).toISOString()

          // Renew the subscription using PATCH
          const res = await fetch(
            `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                expirationDateTime: newExpirationDateTime,
              }),
            }
          )

          if (!res.ok) {
            const error = await res.json()
            logger.error(
              `Failed to renew subscription ${externalSubscriptionId} for webhook ${webhook.id}`,
              {
                status: res.status,
                error: error.error,
              }
            )

            // If subscription not found, try to create a new one
            if (res.status === 404) {
              logger.info(`Subscription not found, creating new one for webhook ${webhook.id}`)
              const created = await recreateSubscription(
                webhook,
                accessToken,
                chatId,
                subscriptionScope
              )
              if (created) {
                renewed++
              } else {
                failed++
              }
            } else {
              failed++
            }
            continue
          }

          const payload = await res.json()

          // Update the expiration time in the database
          const updatedConfig = {
            ...providerConfig,
            subscriptionExpiration: payload.expirationDateTime,
          }

          await db
            .update(webhookTable)
            .set({ providerConfig: updatedConfig, updatedAt: new Date() })
            .where(eq(webhookTable.id, webhook.id))

          logger.info(
            `Successfully renewed subscription ${externalSubscriptionId} for webhook ${webhook.id}. New expiration: ${payload.expirationDateTime}`
          )
          renewed++
        } catch (error) {
          logger.error(`Error renewing subscription for webhook ${webhook.id}:`, error)
          failed++
        }
      }

      logger.info(
        `Teams subscription renewal job completed. Renewed: ${renewed}, Failed: ${failed}`
      )

      return {
        success: true,
        renewed,
        failed,
        total: webhooksWithWorkflows.length,
      }
    } catch (error) {
      logger.error('Error in Teams subscription renewal job:', error)
      throw error
    }
  },
})

/**
 * Recreate a subscription if the original was deleted
 */
async function recreateSubscription(
  webhook: any,
  accessToken: string,
  chatId: string | undefined,
  subscriptionScope: 'chat' | 'all-chats'
): Promise<boolean> {
  try {
    const providerConfig = (webhook.providerConfig as Record<string, any>) || {}

    const notificationUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/trigger/${webhook.path}`
    const resource =
      subscriptionScope === 'all-chats'
        ? '/chats/getAllMessages'
        : chatId
          ? `/chats/${encodeURIComponent(chatId)}/messages`
          : null

    if (!resource) {
      logger.error(`Cannot recreate subscription: missing chat ID for webhook ${webhook.id}`)
      return false
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
      logger.error(`Failed to recreate subscription for webhook ${webhook.id}`, {
        status: res.status,
        error: payload.error,
      })
      return false
    }

    // Update with new subscription ID
    const updatedConfig = {
      ...providerConfig,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }

    await db
      .update(webhookTable)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhookTable.id, webhook.id))

    logger.info(`Recreated subscription ${payload.id} for webhook ${webhook.id}`)
    return true
  } catch (error) {
    logger.error(`Error recreating subscription for webhook ${webhook.id}:`, error)
    return false
  }
}
