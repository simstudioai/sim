import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('TeamsSubscriptions')

export async function createMicrosoftTeamsChatSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
): Promise<boolean> {
  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId
    const subscriptionScope: 'chat' | 'all-chats' = providerConfig.subscriptionScope || 'chat'
    const chatId: string | undefined = providerConfig.chatId

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credentialId for Teams chat subscription creation.`)
      return false
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, userId, requestId)
    if (!accessToken) {
      logger.warn(`[${requestId}] Could not retrieve Teams access token for user ${userId}`)
      return false
    }

    const requestOrigin = new URL(request.url).origin
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? env.NEXT_PUBLIC_APP_URL || requestOrigin
      : requestOrigin

    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${webhookData.path}`
    const resource =
      subscriptionScope === 'all-chats'
        ? '/chats/getAllMessages'
        : chatId
          ? `/chats/${encodeURIComponent(chatId)}/messages`
          : null

    if (!resource) {
      logger.warn(`[${requestId}] Missing chatId for chat scope subscription.`)
      return false
    }

    // Set expiration (max varies; set short and require renewal job later)
    const expirationDateTime = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour

    // For includeResourceData=true we must provide an encryption cert. For now, use false as MVP.
    const body = {
      changeType: 'created,updated',
      notificationUrl,
      resource,
      includeResourceData: false,
      expirationDateTime,
      clientState: webhookData.id,
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
      logger.error(`[${requestId}] Failed to create Teams subscription`, { status: res.status, payload })
      return false
    }

    // Persist subscription id and expiration in providerConfig
    const updatedConfig = {
      ...providerConfig,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }
    await db
      .update(webhookTable)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhookTable.id, webhookData.id))

    logger.info(`[${requestId}] Created Teams chat subscription ${payload.id}`)
    return true
  } catch (error) {
    logger.error('Error creating Teams subscription:', error)
    return false
  }
}


