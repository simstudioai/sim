import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const teamsLogger = createLogger('TeamsSubscription')
const telegramLogger = createLogger('TelegramWebhook')
const airtableLogger = createLogger('AirtableWebhook')
const typeformLogger = createLogger('TypeformWebhook')

function getProviderConfig(webhook: any): Record<string, any> {
  return (webhook.providerConfig as Record<string, any>) || {}
}

function getNotificationUrl(webhook: any): string {
  return `${getBaseUrl()}/api/webhooks/trigger/${webhook.path}`
}

/**
 * Create a Microsoft Teams chat subscription
 * Throws errors with friendly messages if subscription creation fails
 */
export async function createTeamsSubscription(
  request: NextRequest,
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  const config = getProviderConfig(webhook)

  if (config.triggerId !== 'microsoftteams_chat_subscription') {
    return
  }

  const credentialId = config.credentialId as string | undefined
  const chatId = config.chatId as string | undefined

  if (!credentialId) {
    teamsLogger.warn(
      `[${requestId}] Missing credentialId for Teams chat subscription ${webhook.id}`
    )
    throw new Error(
      'Microsoft Teams credentials are required. Please connect your Microsoft account in the trigger configuration.'
    )
  }

  if (!chatId) {
    teamsLogger.warn(`[${requestId}] Missing chatId for Teams chat subscription ${webhook.id}`)
    throw new Error(
      'Chat ID is required to create a Teams subscription. Please provide a valid chat ID.'
    )
  }

  const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
  if (!accessToken) {
    teamsLogger.error(
      `[${requestId}] Failed to get access token for Teams subscription ${webhook.id}`
    )
    throw new Error(
      'Failed to authenticate with Microsoft Teams. Please reconnect your Microsoft account and try again.'
    )
  }

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
        return
      }
    } catch {
      teamsLogger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
    }
  }

  // Always use NEXT_PUBLIC_APP_URL to ensure Microsoft Graph can reach the public endpoint
  const notificationUrl = getNotificationUrl(webhook)
  const resource = `/chats/${chatId}/messages`

  // Max lifetime: 4230 minutes (~3 days) - Microsoft Graph API limit
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

  try {
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
      const errorMessage =
        payload.error?.message || payload.error?.code || 'Unknown Microsoft Graph API error'
      teamsLogger.error(
        `[${requestId}] Failed to create Teams subscription for webhook ${webhook.id}`,
        {
          status: res.status,
          error: payload.error,
        }
      )

      let userFriendlyMessage = 'Failed to create Teams subscription'
      if (res.status === 401 || res.status === 403) {
        userFriendlyMessage =
          'Authentication failed. Please reconnect your Microsoft Teams account and ensure you have the necessary permissions.'
      } else if (res.status === 404) {
        userFriendlyMessage =
          'Chat not found. Please verify that the Chat ID is correct and that you have access to the specified chat.'
      } else if (errorMessage && errorMessage !== 'Unknown Microsoft Graph API error') {
        userFriendlyMessage = `Teams error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    teamsLogger.info(
      `[${requestId}] Successfully created Teams subscription ${payload.id} for webhook ${webhook.id}`
    )
  } catch (error: any) {
    if (
      error instanceof Error &&
      (error.message.includes('credentials') ||
        error.message.includes('Chat ID') ||
        error.message.includes('authenticate'))
    ) {
      throw error
    }

    teamsLogger.error(
      `[${requestId}] Error creating Teams subscription for webhook ${webhook.id}`,
      error
    )
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to create Teams subscription. Please try again.'
    )
  }
}

/**
 * Delete a Microsoft Teams chat subscription
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteTeamsSubscription(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = getProviderConfig(webhook)

    if (config.triggerId !== 'microsoftteams_chat_subscription') {
      return
    }

    const externalSubscriptionId = config.externalSubscriptionId as string | undefined
    const credentialId = config.credentialId as string | undefined

    if (!externalSubscriptionId || !credentialId) {
      teamsLogger.info(
        `[${requestId}] No external subscription to delete for webhook ${webhook.id}`
      )
      return
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, workflow.userId, requestId)
    if (!accessToken) {
      teamsLogger.warn(
        `[${requestId}] Could not get access token to delete Teams subscription for webhook ${webhook.id}`
      )
      return
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
  }
}

/**
 * Create a Telegram bot webhook
 * Throws errors with friendly messages if webhook creation fails
 */
export async function createTelegramWebhook(
  request: NextRequest,
  webhook: any,
  requestId: string
): Promise<void> {
  const config = getProviderConfig(webhook)
  const botToken = config.botToken as string | undefined

  if (!botToken) {
    telegramLogger.warn(`[${requestId}] Missing botToken for Telegram webhook ${webhook.id}`)
    throw new Error(
      'Bot token is required to create a Telegram webhook. Please provide a valid Telegram bot token.'
    )
  }

  const notificationUrl = getNotificationUrl(webhook)
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`

  try {
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

      let userFriendlyMessage = 'Failed to create Telegram webhook'
      if (telegramResponse.status === 401) {
        userFriendlyMessage =
          'Invalid bot token. Please verify that the bot token is correct and try again.'
      } else if (responseBody.description) {
        userFriendlyMessage = `Telegram error: ${responseBody.description}`
      }

      throw new Error(userFriendlyMessage)
    }

    telegramLogger.info(
      `[${requestId}] Successfully created Telegram webhook for webhook ${webhook.id}`
    )
  } catch (error: any) {
    if (
      error instanceof Error &&
      (error.message.includes('Bot token') || error.message.includes('Telegram error'))
    ) {
      throw error
    }

    telegramLogger.error(
      `[${requestId}] Error creating Telegram webhook for webhook ${webhook.id}`,
      error
    )
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to create Telegram webhook. Please try again.'
    )
  }
}

/**
 * Delete a Telegram bot webhook
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteTelegramWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
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
  }
}

/**
 * Delete an Airtable webhook
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteAirtableWebhook(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
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

    let resolvedExternalId: string | undefined = externalId

    if (!resolvedExternalId) {
      try {
        const expectedNotificationUrl = getNotificationUrl(webhook)

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
        // Ignore parse errors
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
  }
}

/**
 * Create a Typeform webhook subscription
 * Throws errors with friendly messages if webhook creation fails
 */
export async function createTypeformWebhook(
  request: NextRequest,
  webhook: any,
  requestId: string
): Promise<string> {
  const config = getProviderConfig(webhook)
  const formId = config.formId as string | undefined
  const apiKey = config.apiKey as string | undefined
  const webhookTag = config.webhookTag as string | undefined
  const secret = config.secret as string | undefined

  if (!formId) {
    typeformLogger.warn(`[${requestId}] Missing formId for Typeform webhook ${webhook.id}`)
    throw new Error(
      'Form ID is required to create a Typeform webhook. Please provide a valid form ID.'
    )
  }

  if (!apiKey) {
    typeformLogger.warn(`[${requestId}] Missing apiKey for Typeform webhook ${webhook.id}`)
    throw new Error(
      'Personal Access Token is required to create a Typeform webhook. Please provide your Typeform API key.'
    )
  }

  const tag = webhookTag || `sim-${webhook.id.substring(0, 8)}`
  const notificationUrl = getNotificationUrl(webhook)

  try {
    const typeformApiUrl = `https://api.typeform.com/forms/${formId}/webhooks/${tag}`

    const requestBody: Record<string, any> = {
      url: notificationUrl,
      enabled: true,
      verify_ssl: true,
      event_types: {
        form_response: true,
      },
    }

    if (secret) {
      requestBody.secret = secret
    }

    const typeformResponse = await fetch(typeformApiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!typeformResponse.ok) {
      const responseBody = await typeformResponse.json().catch(() => ({}))
      const errorMessage = responseBody.description || responseBody.message || 'Unknown error'

      typeformLogger.error(`[${requestId}] Typeform API error: ${errorMessage}`, {
        status: typeformResponse.status,
        response: responseBody,
      })

      let userFriendlyMessage = 'Failed to create Typeform webhook'
      if (typeformResponse.status === 401) {
        userFriendlyMessage =
          'Invalid Personal Access Token. Please verify your Typeform API key and try again.'
      } else if (typeformResponse.status === 403) {
        userFriendlyMessage =
          'Access denied. Please ensure you have a Typeform PRO or PRO+ account and the API key has webhook permissions.'
      } else if (typeformResponse.status === 404) {
        userFriendlyMessage = 'Form not found. Please verify the form ID is correct.'
      } else if (responseBody.description || responseBody.message) {
        userFriendlyMessage = `Typeform error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    const responseBody = await typeformResponse.json()
    typeformLogger.info(
      `[${requestId}] Successfully created Typeform webhook for webhook ${webhook.id} with tag ${tag}`,
      { webhookId: responseBody.id }
    )

    return tag
  } catch (error: any) {
    if (
      error instanceof Error &&
      (error.message.includes('Form ID') ||
        error.message.includes('Personal Access Token') ||
        error.message.includes('Typeform error'))
    ) {
      throw error
    }

    typeformLogger.error(
      `[${requestId}] Error creating Typeform webhook for webhook ${webhook.id}`,
      error
    )
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Failed to create Typeform webhook. Please try again.'
    )
  }
}

/**
 * Delete a Typeform webhook
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteTypeformWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const formId = config.formId as string | undefined
    const apiKey = config.apiKey as string | undefined
    const webhookTag = config.webhookTag as string | undefined

    if (!formId || !apiKey) {
      typeformLogger.warn(
        `[${requestId}] Missing formId or apiKey for Typeform webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    const tag = webhookTag || `sim-${webhook.id.substring(0, 8)}`
    const typeformApiUrl = `https://api.typeform.com/forms/${formId}/webhooks/${tag}`

    const typeformResponse = await fetch(typeformApiUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!typeformResponse.ok && typeformResponse.status !== 404) {
      typeformLogger.warn(
        `[${requestId}] Failed to delete Typeform webhook (non-fatal): ${typeformResponse.status}`
      )
    } else {
      typeformLogger.info(`[${requestId}] Successfully deleted Typeform webhook with tag ${tag}`)
    }
  } catch (error) {
    typeformLogger.warn(`[${requestId}] Error deleting Typeform webhook (non-fatal)`, error)
  }
}

/**
 * Clean up external webhook subscriptions for a webhook
 * Handles Airtable, Teams, Telegram, and Typeform cleanup
 * Don't fail deletion if cleanup fails
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
  } else if (webhook.provider === 'typeform') {
    await deleteTypeformWebhook(webhook, requestId)
  }
}
