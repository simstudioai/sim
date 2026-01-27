import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { validateAirtableId, validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getOAuthToken, refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const teamsLogger = createLogger('TeamsSubscription')
const telegramLogger = createLogger('TelegramWebhook')
const airtableLogger = createLogger('AirtableWebhook')
const typeformLogger = createLogger('TypeformWebhook')
const calendlyLogger = createLogger('CalendlyWebhook')
const grainLogger = createLogger('GrainWebhook')
const lemlistLogger = createLogger('LemlistWebhook')
const webflowLogger = createLogger('WebflowWebhook')

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
): Promise<string | undefined> {
  const config = getProviderConfig(webhook)

  if (config.triggerId !== 'microsoftteams_chat_subscription') {
    return undefined
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
        return existingSubscriptionId
      }
    } catch {
      teamsLogger.debug(`[${requestId}] Existing subscription check failed, will create new one`)
    }
  }

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
    return payload.id as string
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

    const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
    if (!baseIdValidation.isValid) {
      airtableLogger.warn(`[${requestId}] Invalid Airtable base ID format, skipping deletion`, {
        webhookId: webhook.id,
        baseId: baseId.substring(0, 20),
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

    const webhookIdValidation = validateAirtableId(resolvedExternalId, 'ach', 'webhookId')
    if (!webhookIdValidation.isValid) {
      airtableLogger.warn(`[${requestId}] Invalid Airtable webhook ID format, skipping deletion`, {
        webhookId: webhook.id,
        externalId: resolvedExternalId.substring(0, 20),
      })
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
 * Delete a Calendly webhook subscription
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteCalendlyWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const apiKey = config.apiKey as string | undefined
    const externalId = config.externalId as string | undefined

    if (!apiKey) {
      calendlyLogger.warn(
        `[${requestId}] Missing apiKey for Calendly webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    if (!externalId) {
      calendlyLogger.warn(
        `[${requestId}] Missing externalId for Calendly webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    const calendlyApiUrl = `https://api.calendly.com/webhook_subscriptions/${externalId}`

    const calendlyResponse = await fetch(calendlyApiUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!calendlyResponse.ok && calendlyResponse.status !== 404) {
      const responseBody = await calendlyResponse.json().catch(() => ({}))
      calendlyLogger.warn(
        `[${requestId}] Failed to delete Calendly webhook (non-fatal): ${calendlyResponse.status}`,
        { response: responseBody }
      )
    } else {
      calendlyLogger.info(
        `[${requestId}] Successfully deleted Calendly webhook subscription ${externalId}`
      )
    }
  } catch (error) {
    calendlyLogger.warn(`[${requestId}] Error deleting Calendly webhook (non-fatal)`, error)
  }
}

/**
 * Delete a Grain webhook
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteGrainWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const apiKey = config.apiKey as string | undefined
    const externalId = config.externalId as string | undefined

    if (!apiKey) {
      grainLogger.warn(
        `[${requestId}] Missing apiKey for Grain webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    if (!externalId) {
      grainLogger.warn(
        `[${requestId}] Missing externalId for Grain webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    const grainApiUrl = `https://api.grain.com/_/public-api/v2/hooks/${externalId}`

    const grainResponse = await fetch(grainApiUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Public-Api-Version': '2025-10-31',
      },
    })

    if (!grainResponse.ok && grainResponse.status !== 404) {
      const responseBody = await grainResponse.json().catch(() => ({}))
      grainLogger.warn(
        `[${requestId}] Failed to delete Grain webhook (non-fatal): ${grainResponse.status}`,
        { response: responseBody }
      )
    } else {
      grainLogger.info(`[${requestId}] Successfully deleted Grain webhook ${externalId}`)
    }
  } catch (error) {
    grainLogger.warn(`[${requestId}] Error deleting Grain webhook (non-fatal)`, error)
  }
}

/**
 * Delete a Lemlist webhook
 * Don't fail webhook deletion if cleanup fails
 */
export async function deleteLemlistWebhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const apiKey = config.apiKey as string | undefined
    const externalId = config.externalId as string | undefined

    if (!apiKey) {
      lemlistLogger.warn(
        `[${requestId}] Missing apiKey for Lemlist webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    const authString = Buffer.from(`:${apiKey}`).toString('base64')

    const deleteById = async (id: string) => {
      const validation = validateAlphanumericId(id, 'Lemlist hook ID', 50)
      if (!validation.isValid) {
        lemlistLogger.warn(`[${requestId}] Invalid Lemlist hook ID format, skipping deletion`, {
          id: id.substring(0, 30),
        })
        return
      }

      const lemlistApiUrl = `https://api.lemlist.com/api/hooks/${id}`
      const lemlistResponse = await fetch(lemlistApiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${authString}`,
        },
      })

      if (!lemlistResponse.ok && lemlistResponse.status !== 404) {
        const responseBody = await lemlistResponse.json().catch(() => ({}))
        lemlistLogger.warn(
          `[${requestId}] Failed to delete Lemlist webhook (non-fatal): ${lemlistResponse.status}`,
          { response: responseBody }
        )
      } else {
        lemlistLogger.info(`[${requestId}] Successfully deleted Lemlist webhook ${id}`)
      }
    }

    if (externalId) {
      await deleteById(externalId)
      return
    }

    const notificationUrl = getNotificationUrl(webhook)
    const listResponse = await fetch('https://api.lemlist.com/api/hooks', {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authString}`,
      },
    })

    if (!listResponse.ok) {
      lemlistLogger.warn(
        `[${requestId}] Failed to list Lemlist webhooks for cleanup ${webhook.id}`,
        { status: listResponse.status }
      )
      return
    }

    const listBody = await listResponse.json().catch(() => null)
    const hooks: Array<Record<string, any>> = Array.isArray(listBody)
      ? listBody
      : listBody?.hooks || listBody?.data || []
    const matches = hooks.filter((hook) => {
      const targetUrl = hook?.targetUrl || hook?.target_url || hook?.url
      return typeof targetUrl === 'string' && targetUrl === notificationUrl
    })

    if (matches.length === 0) {
      lemlistLogger.info(`[${requestId}] Lemlist webhook not found for cleanup ${webhook.id}`, {
        notificationUrl,
      })
      return
    }

    for (const hook of matches) {
      const hookId = hook?._id || hook?.id
      if (typeof hookId === 'string' && hookId.length > 0) {
        await deleteById(hookId)
      }
    }
  } catch (error) {
    lemlistLogger.warn(`[${requestId}] Error deleting Lemlist webhook (non-fatal)`, error)
  }
}

export async function deleteWebflowWebhook(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const siteId = config.siteId as string | undefined
    const externalId = config.externalId as string | undefined

    if (!siteId) {
      webflowLogger.warn(
        `[${requestId}] Missing siteId for Webflow webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    if (!externalId) {
      webflowLogger.warn(
        `[${requestId}] Missing externalId for Webflow webhook deletion ${webhook.id}, skipping cleanup`
      )
      return
    }

    const siteIdValidation = validateAlphanumericId(siteId, 'siteId', 100)
    if (!siteIdValidation.isValid) {
      webflowLogger.warn(`[${requestId}] Invalid Webflow site ID format, skipping deletion`, {
        webhookId: webhook.id,
        siteId: siteId.substring(0, 30),
      })
      return
    }

    const webhookIdValidation = validateAlphanumericId(externalId, 'webhookId', 100)
    if (!webhookIdValidation.isValid) {
      webflowLogger.warn(`[${requestId}] Invalid Webflow webhook ID format, skipping deletion`, {
        webhookId: webhook.id,
        externalId: externalId.substring(0, 30),
      })
      return
    }

    const accessToken = await getOAuthToken(workflow.userId, 'webflow')
    if (!accessToken) {
      webflowLogger.warn(
        `[${requestId}] Could not retrieve Webflow access token for user ${workflow.userId}. Cannot delete webhook.`,
        { webhookId: webhook.id }
      )
      return
    }

    const webflowApiUrl = `https://api.webflow.com/v2/sites/${siteId}/webhooks/${externalId}`

    const webflowResponse = await fetch(webflowApiUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!webflowResponse.ok && webflowResponse.status !== 404) {
      const responseBody = await webflowResponse.json().catch(() => ({}))
      webflowLogger.warn(
        `[${requestId}] Failed to delete Webflow webhook (non-fatal): ${webflowResponse.status}`,
        { response: responseBody }
      )
    } else {
      webflowLogger.info(`[${requestId}] Successfully deleted Webflow webhook ${externalId}`)
    }
  } catch (error) {
    webflowLogger.warn(`[${requestId}] Error deleting Webflow webhook (non-fatal)`, error)
  }
}

export async function createGrainWebhookSubscription(
  _request: NextRequest,
  webhookData: any,
  requestId: string
): Promise<{ id: string; eventTypes: string[] } | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, triggerId, includeHighlights, includeParticipants, includeAiSummary } =
      providerConfig || {}

    if (!apiKey) {
      grainLogger.warn(`[${requestId}] Missing apiKey for Grain webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Grain API Key is required. Please provide your Grain Personal Access Token in the trigger configuration.'
      )
    }

    const hookTypeMap: Record<string, string> = {
      grain_webhook: 'recording_added',
      grain_recording_created: 'recording_added',
      grain_recording_updated: 'recording_added',
      grain_highlight_created: 'recording_added',
      grain_highlight_updated: 'recording_added',
      grain_story_created: 'recording_added',
      grain_upload_status: 'upload_status',
    }

    const eventTypeMap: Record<string, string[]> = {
      grain_webhook: [],
      grain_recording_created: ['recording_added'],
      grain_recording_updated: ['recording_updated'],
      grain_highlight_created: ['highlight_created'],
      grain_highlight_updated: ['highlight_updated'],
      grain_story_created: ['story_created'],
      grain_upload_status: ['upload_status'],
    }

    const hookType = hookTypeMap[triggerId] ?? 'recording_added'
    const eventTypes = eventTypeMap[triggerId] ?? []

    if (!hookTypeMap[triggerId]) {
      grainLogger.warn(
        `[${requestId}] Unknown triggerId for Grain: ${triggerId}, defaulting to recording_added`,
        {
          webhookId: webhookData.id,
        }
      )
    }

    grainLogger.info(`[${requestId}] Creating Grain webhook`, {
      triggerId,
      hookType,
      eventTypes,
      webhookId: webhookData.id,
    })

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const grainApiUrl = 'https://api.grain.com/_/public-api/v2/hooks/create'

    const requestBody: Record<string, any> = {
      hook_url: notificationUrl,
      hook_type: hookType,
    }

    const include: Record<string, boolean> = {}
    if (includeHighlights) {
      include.highlights = true
    }
    if (includeParticipants) {
      include.participants = true
    }
    if (includeAiSummary) {
      include.ai_summary = true
    }
    if (Object.keys(include).length > 0) {
      requestBody.include = include
    }

    const grainResponse = await fetch(grainApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Public-Api-Version': '2025-10-31',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await grainResponse.json()

    if (!grainResponse.ok || responseBody.error || responseBody.errors) {
      const errorMessage =
        responseBody.errors?.detail ||
        responseBody.error?.message ||
        responseBody.error ||
        responseBody.message ||
        'Unknown Grain API error'
      grainLogger.error(
        `[${requestId}] Failed to create webhook in Grain for webhook ${webhookData.id}. Status: ${grainResponse.status}`,
        { message: errorMessage, response: responseBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Grain'
      if (grainResponse.status === 401) {
        userFriendlyMessage =
          'Invalid Grain API Key. Please verify your Personal Access Token is correct.'
      } else if (grainResponse.status === 403) {
        userFriendlyMessage =
          'Access denied. Please ensure your Grain API Key has appropriate permissions.'
      } else if (errorMessage && errorMessage !== 'Unknown Grain API error') {
        userFriendlyMessage = `Grain error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    grainLogger.info(
      `[${requestId}] Successfully created webhook in Grain for webhook ${webhookData.id}.`,
      {
        grainWebhookId: responseBody.id,
        eventTypes,
      }
    )

    return { id: responseBody.id, eventTypes }
  } catch (error: any) {
    grainLogger.error(
      `[${requestId}] Exception during Grain webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

export async function createLemlistWebhookSubscription(
  webhookData: any,
  requestId: string
): Promise<{ id: string } | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, triggerId, campaignId } = providerConfig || {}

    if (!apiKey) {
      lemlistLogger.warn(`[${requestId}] Missing apiKey for Lemlist webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Lemlist API Key is required. Please provide your Lemlist API Key in the trigger configuration.'
      )
    }

    const eventTypeMap: Record<string, string | undefined> = {
      lemlist_email_replied: 'emailsReplied',
      lemlist_linkedin_replied: 'linkedinReplied',
      lemlist_interested: 'interested',
      lemlist_not_interested: 'notInterested',
      lemlist_email_opened: 'emailsOpened',
      lemlist_email_clicked: 'emailsClicked',
      lemlist_email_bounced: 'emailsBounced',
      lemlist_email_sent: 'emailsSent',
      lemlist_webhook: undefined,
    }

    const eventType = eventTypeMap[triggerId]
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`
    const authString = Buffer.from(`:${apiKey}`).toString('base64')

    lemlistLogger.info(`[${requestId}] Creating Lemlist webhook`, {
      triggerId,
      eventType,
      hasCampaignId: !!campaignId,
      webhookId: webhookData.id,
    })

    const lemlistApiUrl = 'https://api.lemlist.com/api/hooks'

    const requestBody: Record<string, any> = {
      targetUrl: notificationUrl,
    }

    if (eventType) {
      requestBody.type = eventType
    }

    if (campaignId) {
      requestBody.campaignId = campaignId
    }

    const lemlistResponse = await fetch(lemlistApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authString}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await lemlistResponse.json()

    if (!lemlistResponse.ok || responseBody.error) {
      const errorMessage = responseBody.message || responseBody.error || 'Unknown Lemlist API error'
      lemlistLogger.error(
        `[${requestId}] Failed to create webhook in Lemlist for webhook ${webhookData.id}. Status: ${lemlistResponse.status}`,
        { message: errorMessage, response: responseBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Lemlist'
      if (lemlistResponse.status === 401) {
        userFriendlyMessage = 'Invalid Lemlist API Key. Please verify your API Key is correct.'
      } else if (lemlistResponse.status === 403) {
        userFriendlyMessage =
          'Access denied. Please ensure your Lemlist API Key has appropriate permissions.'
      } else if (errorMessage && errorMessage !== 'Unknown Lemlist API error') {
        userFriendlyMessage = `Lemlist error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    lemlistLogger.info(
      `[${requestId}] Successfully created webhook in Lemlist for webhook ${webhookData.id}.`,
      {
        lemlistWebhookId: responseBody._id,
      }
    )

    return { id: responseBody._id }
  } catch (error: any) {
    lemlistLogger.error(
      `[${requestId}] Exception during Lemlist webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

export async function createAirtableWebhookSubscription(
  userId: string,
  webhookData: any,
  requestId: string
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { baseId, tableId, includeCellValuesInFieldIds } = providerConfig || {}

    if (!baseId || !tableId) {
      airtableLogger.warn(
        `[${requestId}] Missing baseId or tableId for Airtable webhook creation.`,
        {
          webhookId: webhookData.id,
        }
      )
      throw new Error(
        'Base ID and Table ID are required to create Airtable webhook. Please provide valid Airtable base and table IDs.'
      )
    }

    const baseIdValidation = validateAirtableId(baseId, 'app', 'baseId')
    if (!baseIdValidation.isValid) {
      throw new Error(baseIdValidation.error)
    }

    const tableIdValidation = validateAirtableId(tableId, 'tbl', 'tableId')
    if (!tableIdValidation.isValid) {
      throw new Error(tableIdValidation.error)
    }

    const accessToken = await getOAuthToken(userId, 'airtable')
    if (!accessToken) {
      airtableLogger.warn(
        `[${requestId}] Could not retrieve Airtable access token for user ${userId}. Cannot create webhook in Airtable.`
      )
      throw new Error(
        'Airtable account connection required. Please connect your Airtable account in the trigger configuration and try again.'
      )
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const airtableApiUrl = `https://api.airtable.com/v0/bases/${baseId}/webhooks`

    const specification: any = {
      options: {
        filters: {
          dataTypes: ['tableData'],
          recordChangeScope: tableId,
        },
      },
    }

    if (includeCellValuesInFieldIds === 'all') {
      specification.options.includes = {
        includeCellValuesInFieldIds: 'all',
      }
    }

    const requestBody: any = {
      notificationUrl: notificationUrl,
      specification: specification,
    }

    const airtableResponse = await fetch(airtableApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await airtableResponse.json()

    if (!airtableResponse.ok || responseBody.error) {
      const errorMessage =
        responseBody.error?.message || responseBody.error || 'Unknown Airtable API error'
      const errorType = responseBody.error?.type
      airtableLogger.error(
        `[${requestId}] Failed to create webhook in Airtable for webhook ${webhookData.id}. Status: ${airtableResponse.status}`,
        { type: errorType, message: errorMessage, response: responseBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Airtable'
      if (airtableResponse.status === 404) {
        userFriendlyMessage =
          'Airtable base or table not found. Please verify that the Base ID and Table ID are correct and that you have access to them.'
      } else if (errorMessage && errorMessage !== 'Unknown Airtable API error') {
        userFriendlyMessage = `Airtable error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }
    airtableLogger.info(
      `[${requestId}] Successfully created webhook in Airtable for webhook ${webhookData.id}.`,
      {
        airtableWebhookId: responseBody.id,
      }
    )
    return responseBody.id
  } catch (error: any) {
    airtableLogger.error(
      `[${requestId}] Exception during Airtable webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

export async function createCalendlyWebhookSubscription(
  webhookData: any,
  requestId: string
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, organization, triggerId } = providerConfig || {}

    if (!apiKey) {
      calendlyLogger.warn(`[${requestId}] Missing apiKey for Calendly webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error(
        'Personal Access Token is required to create Calendly webhook. Please provide your Calendly Personal Access Token.'
      )
    }

    if (!organization) {
      calendlyLogger.warn(
        `[${requestId}] Missing organization URI for Calendly webhook creation.`,
        {
          webhookId: webhookData.id,
        }
      )
      throw new Error(
        'Organization URI is required to create Calendly webhook. Please provide your Organization URI from the "Get Current User" operation.'
      )
    }

    if (!triggerId) {
      calendlyLogger.warn(`[${requestId}] Missing triggerId for Calendly webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Trigger ID is required to create Calendly webhook')
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const eventTypeMap: Record<string, string[]> = {
      calendly_invitee_created: ['invitee.created'],
      calendly_invitee_canceled: ['invitee.canceled'],
      calendly_routing_form_submitted: ['routing_form_submission.created'],
      calendly_webhook: ['invitee.created', 'invitee.canceled', 'routing_form_submission.created'],
    }

    const events = eventTypeMap[triggerId] || ['invitee.created']

    const calendlyApiUrl = 'https://api.calendly.com/webhook_subscriptions'

    const requestBody = {
      url: notificationUrl,
      events,
      organization,
      scope: 'organization',
    }

    const calendlyResponse = await fetch(calendlyApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!calendlyResponse.ok) {
      const errorBody = await calendlyResponse.json().catch(() => ({}))
      const errorMessage = errorBody.message || errorBody.title || 'Unknown Calendly API error'
      calendlyLogger.error(
        `[${requestId}] Failed to create webhook in Calendly for webhook ${webhookData.id}. Status: ${calendlyResponse.status}`,
        { response: errorBody }
      )

      let userFriendlyMessage = 'Failed to create webhook subscription in Calendly'
      if (calendlyResponse.status === 401) {
        userFriendlyMessage =
          'Calendly authentication failed. Please verify your Personal Access Token is correct.'
      } else if (calendlyResponse.status === 403) {
        userFriendlyMessage =
          'Calendly access denied. Please ensure you have appropriate permissions and a paid Calendly subscription.'
      } else if (calendlyResponse.status === 404) {
        userFriendlyMessage =
          'Calendly organization not found. Please verify the Organization URI is correct.'
      } else if (errorMessage && errorMessage !== 'Unknown Calendly API error') {
        userFriendlyMessage = `Calendly error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    const responseBody = await calendlyResponse.json()
    const webhookUri = responseBody.resource?.uri

    if (!webhookUri) {
      calendlyLogger.error(
        `[${requestId}] Calendly webhook created but no webhook URI returned for webhook ${webhookData.id}`,
        { response: responseBody }
      )
      throw new Error('Calendly webhook creation succeeded but no webhook URI was returned')
    }

    const webhookId = webhookUri.split('/').pop()

    if (!webhookId) {
      calendlyLogger.error(
        `[${requestId}] Could not extract webhook ID from Calendly URI: ${webhookUri}`,
        {
          response: responseBody,
        }
      )
      throw new Error('Failed to extract webhook ID from Calendly response')
    }

    calendlyLogger.info(
      `[${requestId}] Successfully created webhook in Calendly for webhook ${webhookData.id}.`,
      {
        calendlyWebhookUri: webhookUri,
        calendlyWebhookId: webhookId,
      }
    )
    return webhookId
  } catch (error: any) {
    calendlyLogger.error(
      `[${requestId}] Exception during Calendly webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

export async function createWebflowWebhookSubscription(
  userId: string,
  webhookData: any,
  requestId: string
): Promise<string | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { siteId, triggerId, collectionId, formName } = providerConfig || {}

    if (!siteId) {
      webflowLogger.warn(`[${requestId}] Missing siteId for Webflow webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Site ID is required to create Webflow webhook')
    }

    const siteIdValidation = validateAlphanumericId(siteId, 'siteId', 100)
    if (!siteIdValidation.isValid) {
      throw new Error(siteIdValidation.error)
    }

    if (!triggerId) {
      webflowLogger.warn(`[${requestId}] Missing triggerId for Webflow webhook creation.`, {
        webhookId: webhookData.id,
      })
      throw new Error('Trigger type is required to create Webflow webhook')
    }

    const accessToken = await getOAuthToken(userId, 'webflow')
    if (!accessToken) {
      webflowLogger.warn(
        `[${requestId}] Could not retrieve Webflow access token for user ${userId}. Cannot create webhook in Webflow.`
      )
      throw new Error(
        'Webflow account connection required. Please connect your Webflow account in the trigger configuration and try again.'
      )
    }

    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const triggerTypeMap: Record<string, string> = {
      webflow_collection_item_created: 'collection_item_created',
      webflow_collection_item_changed: 'collection_item_changed',
      webflow_collection_item_deleted: 'collection_item_deleted',
      webflow_form_submission: 'form_submission',
    }

    const webflowTriggerType = triggerTypeMap[triggerId]
    if (!webflowTriggerType) {
      webflowLogger.warn(`[${requestId}] Invalid triggerId for Webflow: ${triggerId}`, {
        webhookId: webhookData.id,
      })
      throw new Error(`Invalid Webflow trigger type: ${triggerId}`)
    }

    const webflowApiUrl = `https://api.webflow.com/v2/sites/${siteId}/webhooks`

    const requestBody: any = {
      triggerType: webflowTriggerType,
      url: notificationUrl,
    }

    // Note: Webflow API only supports 'filter' for form_submission triggers.
    if (formName && webflowTriggerType === 'form_submission') {
      requestBody.filter = {
        name: formName,
      }
    }

    const webflowResponse = await fetch(webflowApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await webflowResponse.json()

    if (!webflowResponse.ok || responseBody.error) {
      const errorMessage = responseBody.message || responseBody.error || 'Unknown Webflow API error'
      webflowLogger.error(
        `[${requestId}] Failed to create webhook in Webflow for webhook ${webhookData.id}. Status: ${webflowResponse.status}`,
        { message: errorMessage, response: responseBody }
      )
      throw new Error(errorMessage)
    }

    webflowLogger.info(
      `[${requestId}] Successfully created webhook in Webflow for webhook ${webhookData.id}.`,
      {
        webflowWebhookId: responseBody.id || responseBody._id,
      }
    )

    return responseBody.id || responseBody._id
  } catch (error: any) {
    webflowLogger.error(
      `[${requestId}] Exception during Webflow webhook creation for webhook ${webhookData.id}.`,
      {
        message: error.message,
        stack: error.stack,
      }
    )
    throw error
  }
}

type ExternalSubscriptionResult = {
  updatedProviderConfig: Record<string, unknown>
  externalSubscriptionCreated: boolean
}

type RecreateCheckInput = {
  previousProvider: string
  nextProvider: string
  previousConfig: Record<string, unknown>
  nextConfig: Record<string, unknown>
}

/** Providers that create external webhook subscriptions */
const PROVIDERS_WITH_EXTERNAL_SUBSCRIPTIONS = new Set([
  'airtable',
  'calendly',
  'webflow',
  'typeform',
  'grain',
  'lemlist',
  'telegram',
  'microsoft-teams',
])

/** System-managed fields that shouldn't trigger recreation */
const SYSTEM_MANAGED_FIELDS = new Set([
  'externalId',
  'externalSubscriptionId',
  'eventTypes',
  'webhookTag',
  'historyId',
  'lastCheckedTimestamp',
  'setupCompleted',
  'userId',
])

export function shouldRecreateExternalWebhookSubscription({
  previousProvider,
  nextProvider,
  previousConfig,
  nextConfig,
}: RecreateCheckInput): boolean {
  if (previousProvider !== nextProvider) {
    return (
      PROVIDERS_WITH_EXTERNAL_SUBSCRIPTIONS.has(previousProvider) ||
      PROVIDERS_WITH_EXTERNAL_SUBSCRIPTIONS.has(nextProvider)
    )
  }

  if (!PROVIDERS_WITH_EXTERNAL_SUBSCRIPTIONS.has(nextProvider)) {
    return false
  }

  const allKeys = new Set([...Object.keys(previousConfig), ...Object.keys(nextConfig)])

  for (const key of allKeys) {
    if (SYSTEM_MANAGED_FIELDS.has(key)) continue

    const prevVal = previousConfig[key]
    const nextVal = nextConfig[key]

    const prevStr = typeof prevVal === 'object' ? JSON.stringify(prevVal ?? null) : prevVal
    const nextStr = typeof nextVal === 'object' ? JSON.stringify(nextVal ?? null) : nextVal

    if (prevStr !== nextStr) {
      return true
    }
  }

  return false
}

export async function createExternalWebhookSubscription(
  request: NextRequest,
  webhookData: any,
  workflow: any,
  userId: string,
  requestId: string
): Promise<ExternalSubscriptionResult> {
  const provider = webhookData.provider as string
  const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
  let updatedProviderConfig = providerConfig
  let externalSubscriptionCreated = false

  if (provider === 'airtable') {
    const externalId = await createAirtableWebhookSubscription(userId, webhookData, requestId)
    if (externalId) {
      updatedProviderConfig = { ...updatedProviderConfig, externalId }
      externalSubscriptionCreated = true
    }
  } else if (provider === 'calendly') {
    const externalId = await createCalendlyWebhookSubscription(webhookData, requestId)
    if (externalId) {
      updatedProviderConfig = { ...updatedProviderConfig, externalId }
      externalSubscriptionCreated = true
    }
  } else if (provider === 'microsoft-teams') {
    const subscriptionId = await createTeamsSubscription(request, webhookData, workflow, requestId)
    if (subscriptionId) {
      updatedProviderConfig = { ...updatedProviderConfig, externalSubscriptionId: subscriptionId }
      externalSubscriptionCreated = true
    }
  } else if (provider === 'telegram') {
    await createTelegramWebhook(request, webhookData, requestId)
    externalSubscriptionCreated = true
  } else if (provider === 'webflow') {
    const externalId = await createWebflowWebhookSubscription(userId, webhookData, requestId)
    if (externalId) {
      updatedProviderConfig = { ...updatedProviderConfig, externalId }
      externalSubscriptionCreated = true
    }
  } else if (provider === 'typeform') {
    const usedTag = await createTypeformWebhook(request, webhookData, requestId)
    if (!updatedProviderConfig.webhookTag && usedTag) {
      updatedProviderConfig = { ...updatedProviderConfig, webhookTag: usedTag }
    }
    externalSubscriptionCreated = true
  } else if (provider === 'grain') {
    const result = await createGrainWebhookSubscription(request, webhookData, requestId)
    if (result) {
      updatedProviderConfig = {
        ...updatedProviderConfig,
        externalId: result.id,
        eventTypes: result.eventTypes,
      }
      externalSubscriptionCreated = true
    }
  } else if (provider === 'lemlist') {
    const result = await createLemlistWebhookSubscription(webhookData, requestId)
    if (result) {
      updatedProviderConfig = { ...updatedProviderConfig, externalId: result.id }
      externalSubscriptionCreated = true
    }
  }

  return { updatedProviderConfig, externalSubscriptionCreated }
}

/**
 * Clean up external webhook subscriptions for a webhook
 * Handles Airtable, Teams, Telegram, Typeform, Calendly, Grain, and Lemlist cleanup
 * Don't fail deletion if cleanup fails
 */
export async function cleanupExternalWebhook(
  webhook: any,
  workflow: any,
  requestId: string
): Promise<void> {
  if (webhook.provider === 'airtable') {
    await deleteAirtableWebhook(webhook, workflow, requestId)
  } else if (webhook.provider === 'microsoft-teams') {
    await deleteTeamsSubscription(webhook, workflow, requestId)
  } else if (webhook.provider === 'telegram') {
    await deleteTelegramWebhook(webhook, requestId)
  } else if (webhook.provider === 'typeform') {
    await deleteTypeformWebhook(webhook, requestId)
  } else if (webhook.provider === 'calendly') {
    await deleteCalendlyWebhook(webhook, requestId)
  } else if (webhook.provider === 'webflow') {
    await deleteWebflowWebhook(webhook, workflow, requestId)
  } else if (webhook.provider === 'grain') {
    await deleteGrainWebhook(webhook, requestId)
  } else if (webhook.provider === 'lemlist') {
    await deleteLemlistWebhook(webhook, requestId)
  }
}
