import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Netlify')

/**
 * Verifies a Netlify outgoing webhook JWT signature (HS256, iss=netlify).
 * The token's `sha256` claim must equal the SHA-256 hex digest of the raw body.
 */
function verifyNetlifyJwt(token: string, secret: string, rawBody: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [headerB64, payloadB64, signatureB64] = parts

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  if (!safeCompare(expectedSignature, signatureB64)) {
    return false
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return false
  }

  if (payload.iss !== 'netlify') return false

  const bodyHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
  if (typeof payload.sha256 !== 'string') return false
  return safeCompare(payload.sha256, bodyHash)
}

export const netlifyHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secret = (providerConfig.webhookSecret as string | undefined)?.trim()
    if (!secret) {
      logger.warn(`[${requestId}] Netlify webhook secret missing; rejecting delivery`)
      return new NextResponse(
        'Unauthorized - Netlify webhook signing secret is not configured. Re-save the trigger so a webhook can be registered.',
        { status: 401 }
      )
    }

    const signature = request.headers.get('x-webhook-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Netlify webhook missing X-Webhook-Signature header`)
      return new NextResponse('Unauthorized - Missing Netlify signature', { status: 401 })
    }

    if (!verifyNetlifyJwt(signature, secret, rawBody)) {
      logger.warn(`[${requestId}] Netlify signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Netlify signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    const { isNetlifyEventMatch } = await import('@/triggers/netlify/utils')
    const obj = body as Record<string, unknown>
    const state = typeof obj.state === 'string' ? obj.state : undefined

    if (!isNetlifyEventMatch(triggerId, state)) {
      logger.debug(`[${requestId}] Netlify event mismatch for trigger ${triggerId}. Skipping.`, {
        webhookId: webhook.id,
        workflowId: workflow.id,
        triggerId,
        state,
      })
      return false
    }

    return true
  },

  extractIdempotencyId(body: unknown) {
    const id = (body as Record<string, unknown>)?.id
    if (id === undefined || id === null || id === '') {
      return null
    }
    return `netlify:${String(id)}`
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const siteId = (providerConfig.siteId as string | undefined)?.trim()

      if (!apiKey) {
        throw new Error(
          'Netlify Personal Access Token is required. Provide your access token in the trigger configuration.'
        )
      }
      if (!siteId) {
        throw new Error('Netlify Site ID is required to register a deploy webhook.')
      }
      if (!triggerId) {
        throw new Error('Missing trigger ID — re-save the Netlify trigger.')
      }

      const { NETLIFY_TRIGGER_EVENT_TYPES } = await import('@/triggers/netlify/utils')
      const event = NETLIFY_TRIGGER_EVENT_TYPES[triggerId]
      if (!event) {
        throw new Error(
          `Unknown Netlify trigger "${triggerId}". Remove and re-add the Netlify trigger, then save again.`
        )
      }

      const notificationUrl = getNotificationUrl(webhook)
      const signingSecret = crypto.randomBytes(32).toString('base64url')

      logger.info(`[${requestId}] Creating Netlify webhook`, {
        triggerId,
        event,
        siteId,
        webhookId: webhook.id,
      })

      const apiUrl = `https://api.netlify.com/api/v1/hooks?site_id=${encodeURIComponent(siteId)}`
      const requestBody = {
        type: 'url',
        event,
        data: {
          url: notificationUrl,
          signature_secret: signingSecret,
        },
      }

      const netlifyResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await netlifyResponse.json().catch(() => ({}))) as Record<
        string,
        unknown
      >

      if (!netlifyResponse.ok) {
        const errorMessage =
          (responseBody.message as string) ||
          (responseBody.error as string) ||
          'Unknown Netlify API error'

        let userFriendlyMessage = 'Failed to create webhook subscription in Netlify'
        if (netlifyResponse.status === 401 || netlifyResponse.status === 403) {
          userFriendlyMessage =
            'Invalid or insufficient Netlify Personal Access Token. Verify the token has access to this site.'
        } else if (netlifyResponse.status === 404) {
          userFriendlyMessage = `Netlify site "${siteId}" not found or not accessible with this token.`
        } else if (errorMessage && errorMessage !== 'Unknown Netlify API error') {
          userFriendlyMessage = `Netlify error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const externalId = (responseBody.id as string | undefined) ?? undefined
      if (!externalId) {
        throw new Error('Netlify webhook creation succeeded but no hook ID was returned')
      }

      logger.info(`[${requestId}] Successfully created Netlify hook ${externalId}`, {
        webhookId: webhook.id,
        event,
      })

      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret: signingSecret,
        },
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${requestId}] Exception during Netlify webhook creation`, {
        message: err.message,
        webhookId: webhook.id,
      })
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing apiKey or externalId for Netlify webhook deletion ${webhook.id}, skipping cleanup`
        )
        if (ctx.strict) throw new Error('Missing Netlify webhook deletion credentials')
        return
      }

      const apiUrl = `https://api.netlify.com/api/v1/hooks/${encodeURIComponent(externalId)}`

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok && response.status !== 404) {
        logger.warn(
          `[${requestId}] Failed to delete Netlify webhook (non-fatal): ${response.status}`
        )
        if (ctx.strict) throw new Error(`Failed to delete Netlify webhook: ${response.status}`)
      } else {
        await response.body?.cancel()
        logger.info(`[${requestId}] Successfully deleted Netlify hook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Netlify webhook (non-fatal)`, error)
      if (ctx.strict) throw error
    }
  },

  async formatInput(ctx: FormatInputContext): Promise<FormatInputResult> {
    const body = ctx.body as Record<string, unknown>

    const str = (v: unknown): string => (v == null ? '' : String(v))

    return {
      input: {
        id: str(body.id),
        siteId: str(body.site_id),
        state: str(body.state),
        name: str(body.name),
        url: str(body.url),
        deployUrl: str(body.deploy_url),
        deploySslUrl: str(body.deploy_ssl_url),
        adminUrl: str(body.admin_url),
        branch: str(body.branch),
        context: str(body.context),
        commitRef: str(body.commit_ref),
        commitUrl: str(body.commit_url),
        title: str(body.title),
        errorMessage: str(body.error_message),
        createdAt: str(body.created_at),
        updatedAt: str(body.updated_at),
        publishedAt: str(body.published_at),
        payload: body,
      },
    }
  },
}
