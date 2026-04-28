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

const logger = createLogger('WebhookProvider:Vercel')

function verifyVercelSignature(secret: string, signature: string, rawBody: string): boolean {
  const hash = crypto.createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex')
  return safeCompare(hash, signature)
}

export const vercelHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secret = (providerConfig.webhookSecret as string | undefined)?.trim()
    if (!secret) {
      logger.warn(`[${requestId}] Vercel webhook secret missing; rejecting delivery`)
      return new NextResponse(
        'Unauthorized - Vercel webhook signing secret is not configured. Re-save the trigger so a webhook can be registered.',
        { status: 401 }
      )
    }

    const signature = request.headers.get('x-vercel-signature')
    if (!signature) {
      logger.warn(`[${requestId}] Vercel webhook missing x-vercel-signature header`)
      return new NextResponse('Unauthorized - Missing Vercel signature', { status: 401 })
    }

    if (!verifyVercelSignature(secret, signature, rawBody)) {
      logger.warn(`[${requestId}] Vercel signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Vercel signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>
    const eventType = obj.type as string | undefined

    if (triggerId && triggerId !== 'vercel_webhook') {
      const { isVercelEventMatch } = await import('@/triggers/vercel/utils')
      if (!isVercelEventMatch(triggerId, eventType)) {
        logger.debug(`[${requestId}] Vercel event mismatch for trigger ${triggerId}. Skipping.`, {
          webhookId: webhook.id,
          workflowId: workflow.id,
          triggerId,
          eventType,
        })
        return false
      }
    }

    return true
  },

  extractIdempotencyId(body: unknown) {
    const id = (body as Record<string, unknown>)?.id
    if (id === undefined || id === null || id === '') {
      return null
    }
    return `vercel:${String(id)}`
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const { webhook, requestId } = ctx
    try {
      const providerConfig = getProviderConfig(webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined
      const teamId = providerConfig.teamId as string | undefined
      const filterProjectIds = providerConfig.filterProjectIds as string | undefined

      if (!apiKey) {
        throw new Error(
          'Vercel Access Token is required. Please provide your access token in the trigger configuration.'
        )
      }

      const { VERCEL_GENERIC_TRIGGER_EVENT_TYPES, VERCEL_TRIGGER_EVENT_TYPES } = await import(
        '@/triggers/vercel/utils'
      )

      if (
        triggerId &&
        triggerId !== 'vercel_webhook' &&
        !(triggerId in VERCEL_TRIGGER_EVENT_TYPES)
      ) {
        throw new Error(
          `Unknown Vercel trigger "${triggerId}". Remove and re-add the Vercel trigger, then save again.`
        )
      }

      const events =
        triggerId && triggerId !== 'vercel_webhook'
          ? [VERCEL_TRIGGER_EVENT_TYPES[triggerId]]
          : undefined
      const notificationUrl = getNotificationUrl(webhook)

      logger.info(`[${requestId}] Creating Vercel webhook`, {
        triggerId,
        events,
        hasTeamId: !!teamId,
        hasProjectIds: !!filterProjectIds,
        webhookId: webhook.id,
      })

      /**
       * Vercel requires an explicit events list — there is no "subscribe to all" option.
       * For the generic webhook trigger, we subscribe to the most commonly useful events.
       * Full list: https://vercel.com/docs/webhooks/webhooks-api#event-types
       */
      const requestBody: Record<string, unknown> = {
        url: notificationUrl,
        events: events || [...VERCEL_GENERIC_TRIGGER_EVENT_TYPES],
      }

      if (filterProjectIds) {
        const projectIds = String(filterProjectIds)
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean)
        if (projectIds.length > 0) {
          requestBody.projectIds = projectIds
        }
      }

      const apiUrl = teamId
        ? `https://api.vercel.com/v1/webhooks?teamId=${encodeURIComponent(teamId)}`
        : 'https://api.vercel.com/v1/webhooks'

      const vercelResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await vercelResponse.json().catch(() => ({}))) as Record<
        string,
        unknown
      >

      if (!vercelResponse.ok) {
        const errorObj = responseBody.error as Record<string, unknown> | undefined
        const errorMessage =
          (errorObj?.message as string) ||
          (responseBody.message as string) ||
          'Unknown Vercel API error'

        let userFriendlyMessage = 'Failed to create webhook subscription in Vercel'
        if (vercelResponse.status === 401 || vercelResponse.status === 403) {
          userFriendlyMessage =
            'Invalid or insufficient Vercel Access Token. Please verify your token has the correct permissions.'
        } else if (errorMessage && errorMessage !== 'Unknown Vercel API error') {
          userFriendlyMessage = `Vercel error: ${errorMessage}`
        }

        throw new Error(userFriendlyMessage)
      }

      const externalId = responseBody.id as string | undefined
      if (!externalId) {
        throw new Error('Vercel webhook creation succeeded but no webhook ID was returned')
      }

      logger.info(
        `[${requestId}] Successfully created webhook in Vercel for webhook ${webhook.id}.`,
        { vercelWebhookId: externalId }
      )

      const signingSecret = responseBody.secret as string | undefined
      if (!signingSecret) {
        throw new Error(
          'Vercel webhook was created but no signing secret was returned. Delete the webhook in Vercel and save this trigger again.'
        )
      }

      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret: signingSecret,
        },
      }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(
        `[${requestId}] Exception during Vercel webhook creation for webhook ${webhook.id}.`,
        { message: err.message, stack: err.stack }
      )
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const { webhook, requestId } = ctx
    try {
      const config = getProviderConfig(webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined
      const teamId = config.teamId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(
          `[${requestId}] Missing apiKey or externalId for Vercel webhook deletion ${webhook.id}, skipping cleanup`
        )
        return
      }

      const apiUrl = teamId
        ? `https://api.vercel.com/v1/webhooks/${encodeURIComponent(externalId)}?teamId=${encodeURIComponent(teamId)}`
        : `https://api.vercel.com/v1/webhooks/${encodeURIComponent(externalId)}`

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })

      if (!response.ok && response.status !== 404) {
        logger.warn(
          `[${requestId}] Failed to delete Vercel webhook (non-fatal): ${response.status}`
        )
      } else {
        await response.body?.cancel()
        logger.info(`[${requestId}] Successfully deleted Vercel webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${requestId}] Error deleting Vercel webhook (non-fatal)`, error)
    }
  },

  async formatInput(ctx: FormatInputContext): Promise<FormatInputResult> {
    const body = ctx.body as Record<string, unknown>
    const payload = (body.payload || {}) as Record<string, unknown>

    const deployment = payload.deployment ?? null
    const project = payload.project ?? null
    const team = payload.team ?? null
    const user = payload.user ?? null
    const domain = payload.domain ?? null

    const linksRaw = payload.links
    let links: { deployment: string; project: string } | null = null
    if (linksRaw && typeof linksRaw === 'object' && !Array.isArray(linksRaw)) {
      const L = linksRaw as Record<string, unknown>
      const dep = L.deployment
      const proj = L.project
      if (typeof dep === 'string' || typeof proj === 'string') {
        links = {
          deployment: typeof dep === 'string' ? dep : '',
          project: typeof proj === 'string' ? proj : '',
        }
      }
    }

    const regionsRaw = payload.regions
    const regions = Array.isArray(regionsRaw) ? regionsRaw : null

    let deploymentMeta: Record<string, unknown> | null = null
    if (deployment && typeof deployment === 'object') {
      const meta = (deployment as Record<string, unknown>).meta
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        deploymentMeta = meta as Record<string, unknown>
      }
    }

    return {
      input: {
        type: body.type ?? '',
        id: body.id != null ? String(body.id) : '',
        createdAt: (() => {
          const v = body.createdAt
          if (typeof v === 'number' && !Number.isNaN(v)) {
            return v
          }
          if (typeof v === 'string') {
            const parsed = Date.parse(v)
            return Number.isNaN(parsed) ? 0 : parsed
          }
          const n = Number(v)
          return Number.isNaN(n) ? 0 : n
        })(),
        region: body.region != null ? String(body.region) : null,
        payload,
        links,
        regions,
        deployment:
          deployment && typeof deployment === 'object'
            ? {
                id:
                  (deployment as Record<string, unknown>).id != null
                    ? String((deployment as Record<string, unknown>).id)
                    : '',
                url: ((deployment as Record<string, unknown>).url as string) ?? '',
                name: ((deployment as Record<string, unknown>).name as string) ?? '',
                meta: deploymentMeta,
              }
            : null,
        project:
          project && typeof project === 'object'
            ? {
                id:
                  (project as Record<string, unknown>).id != null
                    ? String((project as Record<string, unknown>).id)
                    : '',
                name: ((project as Record<string, unknown>).name as string) ?? '',
              }
            : null,
        team:
          team && typeof team === 'object'
            ? {
                id:
                  (team as Record<string, unknown>).id != null
                    ? String((team as Record<string, unknown>).id)
                    : '',
              }
            : null,
        user:
          user && typeof user === 'object'
            ? {
                id:
                  (user as Record<string, unknown>).id != null
                    ? String((user as Record<string, unknown>).id)
                    : '',
              }
            : null,
        target: payload.target != null ? String(payload.target) : null,
        plan: payload.plan != null ? String(payload.plan) : null,
        domain:
          domain && typeof domain === 'object'
            ? {
                name: ((domain as Record<string, unknown>).name as string) ?? '',
                delegated:
                  typeof (domain as Record<string, unknown>).delegated === 'boolean'
                    ? ((domain as Record<string, unknown>).delegated as boolean)
                    : null,
              }
            : null,
      },
    }
  },
}
