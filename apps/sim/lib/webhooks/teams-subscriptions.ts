import { db } from '@sim/db'
import { webhook as webhookTable } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export async function createMicrosoftTeamsChatSubscription(
  request: NextRequest,
  userId: string,
  webhookData: any,
  requestId: string
): Promise<boolean> {
  try {
    const providerConfig = (webhookData.providerConfig as Record<string, any>) || {}
    const credentialId: string | undefined = providerConfig.credentialId
    const chatId: string | undefined = providerConfig.chatId

    if (!credentialId) return false

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, userId, requestId)
    if (!accessToken) return false

    const requestOrigin = new URL(request.url).origin
    const effectiveOrigin = requestOrigin.includes('localhost')
      ? env.NEXT_PUBLIC_APP_URL || requestOrigin
      : requestOrigin

    const notificationUrl = `${effectiveOrigin}/api/webhooks/trigger/${webhookData.path}`
    const resource = chatId ? `/chats/${chatId}/messages` : null

    if (!resource) return false

    // Clean up existing Teams chat subscriptions for this credential
    try {
      const listResponse = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (listResponse.ok) {
        const data = await listResponse.json()
        const allSubscriptions = data.value || []
        const chatSubscriptions = allSubscriptions.filter((sub: any) =>
          sub.resource?.includes('/chats/') && sub.clientState === webhookData.id
        )

        for (const sub of chatSubscriptions) {
          try {
            const notificationUrl = sub.notificationUrl || ''
            const isOurSubscription = notificationUrl.includes('/api/webhooks/trigger/')

            if (isOurSubscription) {
              await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.id}`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              })
            }
          } catch {}
        }
      }
    } catch {}

    const maxLifetimeMinutes = 4230
    const expirationDateTime = new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString()

    const body = {
      changeType: 'created,updated',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
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
      return false
    }

    const updatedConfig = {
      ...providerConfig,
      externalSubscriptionId: payload.id,
      subscriptionExpiration: payload.expirationDateTime,
    }
    await db
      .update(webhookTable)
      .set({
        providerConfig: updatedConfig,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(webhookTable.id, webhookData.id))

    return true
  } catch {
    return false
  }
}
