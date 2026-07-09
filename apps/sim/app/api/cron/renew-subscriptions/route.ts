import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialOwner, getNotificationUrl } from '@/lib/webhooks/provider-subscription-utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TeamsSubscriptionRenewal')

const LOCK_KEY = 'teams-subscription-renewal-lock'
/** Lock TTL in seconds — generous enough to cover the Graph API renewal loop. */
const LOCK_TTL_SECONDS = 300

/** Microsoft Graph subscriptions are hard-capped at ~3 days. */
const MAX_LIFETIME_MINUTES = 4230

/**
 * Recreate a Teams chat subscription from scratch after the existing one has
 * actually expired on Microsoft's side (PATCH returns 404/410). Without this,
 * a subscription that expires while every renewal attempt in its 48h window
 * failed (revoked consent, prolonged Graph outage, etc.) would stay dead
 * forever — the webhook remains `isActive` but never receives events again.
 */
async function recreateSubscription(
  webhook: Record<string, unknown>,
  config: Record<string, any>,
  accessToken: string
): Promise<{ id: string; expirationDateTime: string } | null> {
  const chatId = config.chatId as string | undefined
  if (!chatId) {
    logger.error(`Missing chatId for webhook ${webhook.id}, cannot recreate subscription`)
    return null
  }

  const notificationUrl = getNotificationUrl(webhook)
  const expirationDateTime = new Date(Date.now() + MAX_LIFETIME_MINUTES * 60 * 1000).toISOString()

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created,updated',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource: `/chats/${chatId}/messages`,
      includeResourceData: false,
      expirationDateTime,
      clientState: webhook.id,
    }),
  })

  if (!res.ok) {
    const error = await res.json()
    logger.error(`Failed to recreate Teams subscription for webhook ${webhook.id}`, {
      status: res.status,
      error: error.error,
    })
    return null
  }

  const payload = await res.json()
  return { id: payload.id as string, expirationDateTime: payload.expirationDateTime as string }
}

/**
 * Renews Microsoft Teams chat subscriptions that are close to expiring.
 *
 * Teams subscriptions expire after ~3 days and must be renewed. Runs detached
 * from the HTTP response so the cron caller does not wait for the Graph API loop.
 */
async function renewExpiringSubscriptions(): Promise<{
  checked: number
  renewed: number
  failed: number
  total: number
}> {
  logger.info('Starting Teams subscription renewal job')

  let totalRenewed = 0
  let totalFailed = 0
  let totalChecked = 0

  const webhooksWithWorkflows = await db
    .select({
      webhook: webhookTable,
    })
    .from(webhookTable)
    .where(
      and(
        eq(webhookTable.isActive, true),
        or(
          eq(webhookTable.provider, 'microsoft-teams'),
          eq(webhookTable.provider, 'microsoftteams')
        )
      )
    )

  logger.info(
    `Found ${webhooksWithWorkflows.length} active Teams webhooks, checking for expiring subscriptions`
  )

  /** Renew any subscription expiring within the next 48 hours. */
  const renewalThreshold = new Date(Date.now() + 48 * 60 * 60 * 1000)

  for (const { webhook } of webhooksWithWorkflows) {
    const config = (webhook.providerConfig as Record<string, any>) || {}

    if (config.triggerId !== 'microsoftteams_chat_subscription') continue

    const expirationStr = config.subscriptionExpiration as string | undefined
    if (!expirationStr) continue

    const expiresAt = new Date(expirationStr)
    if (expiresAt > renewalThreshold) continue

    totalChecked++
    const requestId = `renewal-${webhook.id}`

    try {
      logger.info(
        `Renewing Teams subscription for webhook ${webhook.id} (expires: ${expiresAt.toISOString()})`
      )

      const credentialId = config.credentialId as string | undefined
      const externalSubscriptionId = config.externalSubscriptionId as string | undefined

      if (!credentialId || !externalSubscriptionId) {
        logger.error(`Missing credentialId or externalSubscriptionId for webhook ${webhook.id}`)
        totalFailed++
        continue
      }

      const credentialOwner = await getCredentialOwner(credentialId, requestId)
      if (!credentialOwner) {
        logger.error(`Credential owner not found for credential ${credentialId}`)
        totalFailed++
        continue
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialOwner.accountId,
        credentialOwner.userId,
        requestId
      )

      if (!accessToken) {
        logger.error(`Failed to get access token for webhook ${webhook.id}`)
        totalFailed++
        continue
      }

      const newExpirationDateTime = new Date(
        Date.now() + MAX_LIFETIME_MINUTES * 60 * 1000
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

      let newSubscriptionId: string | undefined
      let newExpiration: string | undefined

      if (!res.ok) {
        const error = await res.json()
        logger.error(
          `Failed to renew Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`,
          { status: res.status, error: error.error }
        )

        if (res.status === 404 || res.status === 410) {
          const recreated = await recreateSubscription(webhook, config, accessToken)
          if (!recreated) {
            totalFailed++
            continue
          }
          newSubscriptionId = recreated.id
          newExpiration = recreated.expirationDateTime
          logger.info(
            `Recreated Teams subscription for webhook ${webhook.id} after the previous one expired (new id: ${newSubscriptionId})`
          )
        } else {
          totalFailed++
          continue
        }
      } else {
        const payload = await res.json()
        newExpiration = payload.expirationDateTime as string
      }

      const updatedConfig = {
        ...config,
        ...(newSubscriptionId ? { externalSubscriptionId: newSubscriptionId } : {}),
        subscriptionExpiration: newExpiration,
      }

      await db
        .update(webhookTable)
        .set({ providerConfig: updatedConfig, updatedAt: new Date() })
        .where(eq(webhookTable.id, webhook.id))

      logger.info(
        `Successfully renewed Teams subscription for webhook ${webhook.id}. New expiration: ${newExpiration}`
      )
      totalRenewed++
    } catch (error) {
      logger.error(`Error renewing subscription for webhook ${webhook.id}:`, error)
      totalFailed++
    }
  }

  logger.info(
    `Teams subscription renewal job completed. Checked: ${totalChecked}, Renewed: ${totalRenewed}, Failed: ${totalFailed}`
  )

  return {
    checked: totalChecked,
    renewed: totalRenewed,
    failed: totalFailed,
    total: webhooksWithWorkflows.length,
  }
}

/**
 * Cron endpoint to renew Microsoft Teams chat subscriptions before they expire.
 * Configured in helm/sim/values.yaml under cronjobs.jobs.renewSubscriptions.
 *
 * Acknowledges the cron call immediately and renews subscriptions in the
 * background; a Redis lock prevents overlapping runs.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Teams subscription renewal')
  if (authError) {
    return authError
  }

  const lockValue = generateShortId()
  const locked = await acquireLock(LOCK_KEY, lockValue, LOCK_TTL_SECONDS)
  if (!locked) {
    return NextResponse.json(
      { success: true, message: 'Renewal already in progress – skipped', status: 'skip' },
      { status: 202 }
    )
  }

  runDetached('teams-subscription-renewal', async () => {
    try {
      await renewExpiringSubscriptions()
    } finally {
      await releaseLock(LOCK_KEY, lockValue).catch(() => {})
    }
  })

  return NextResponse.json(
    { success: true, message: 'Teams subscription renewal started', status: 'started' },
    { status: 202 }
  )
})
