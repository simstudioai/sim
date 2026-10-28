import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import {
  buildFallbackDeliveryFingerprint,
  createHmacVerifier,
  isProviderConfigFlagEnabled,
} from '@/lib/webhooks/providers/utils'
import { planeApiUrl, planeHeaders, planeRedirectPolicy } from '@/tools/plane/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('WebhookProvider:Plane')

function planeEventIdentifier(body: unknown): string {
  const payload = toRecord(body)
  if (payload.version === 'v2' && typeof payload.event_id === 'string' && payload.event_id) {
    return `event:${payload.event_id}`
  }
  return buildFallbackDeliveryFingerprint(body)
}

function recordProjectId(value: unknown): string | null {
  const record = toRecord(value)
  if (typeof record.project_id === 'string') return record.project_id
  if (typeof record.project === 'string') return record.project
  const project = toRecord(record.project)
  return typeof project.id === 'string' ? project.id : null
}

async function planeWebhookRequest(
  config: Record<string, unknown>,
  method: string,
  suffix = '',
  body?: Record<string, unknown>
) {
  const slug = config.triggerWorkspaceSlug
  const apiKey = config.triggerApiKey
  if (typeof slug !== 'string' || !slug.trim() || typeof apiKey !== 'string') {
    throw new Error('Plane workspace slug and API token are required for automatic registration')
  }
  const baseUrl = typeof config.triggerBaseUrl === 'string' ? config.triggerBaseUrl : undefined
  return secureFetchWithValidation(
    planeApiUrl(
      baseUrl,
      `/api/v2/workspaces/${safeUrlPathSegment(slug.trim(), 'workspaceSlug')}/webhooks/${suffix}`
    ),
    {
      method,
      headers: planeHeaders(apiKey),
      body: body === undefined ? undefined : JSON.stringify(body),
      profile: 'configuredEndpoint',
      redirectPolicy: planeRedirectPolicy(),
      timeout: 30_000,
      maxResponseBytes: 1024 * 1024,
    },
    'Plane instance URL'
  )
}

async function deletePlaneWebhook(
  config: Record<string, unknown>,
  externalId: string
): Promise<void> {
  const response = await planeWebhookRequest(
    config,
    'DELETE',
    `${safeUrlPathSegment(externalId, 'webhookId')}/`
  )
  if (!response.ok && response.status !== 404)
    throw new Error(`Plane webhook deletion failed (HTTP ${response.status})`)
}

function previousPlaneDeliveryConfig(
  providerConfig: Record<string, unknown>,
  payload: unknown
): Record<string, unknown> | undefined {
  const previous = toRecord(providerConfig.previousSubscription)
  const config = toRecord(previous.providerConfig)
  return previous.provider === 'plane' &&
    typeof config.externalId === 'string' &&
    toRecord(payload).webhook_id === config.externalId
    ? config
    : undefined
}

const verifyPlaneSignature = createHmacVerifier({
  configKey: 'webhookSecret',
  headerName: 'X-Plane-Signature',
  providerLabel: 'Plane',
  requireSecret: true,
  validateFn: (secret, signature, rawBody) =>
    typeof secret === 'string' &&
    secret.length > 0 &&
    /^[a-f0-9]{64}$/.test(signature) &&
    safeCompare(hmacSha256Hex(rawBody, secret), signature),
})

export const planeHandler: WebhookProviderHandler = {
  verifyAuth(ctx) {
    let providerConfig = ctx.providerConfig
    if (
      providerConfig.subscriptionActivationPending === true &&
      providerConfig.previousSubscription
    ) {
      try {
        const payload: unknown = JSON.parse(ctx.rawBody)
        providerConfig = previousPlaneDeliveryConfig(providerConfig, payload) ?? providerConfig
      } catch {}
    }
    return verifyPlaneSignature({ ...ctx, providerConfig })
  },

  async matchEvent({ body, providerConfig }) {
    const { planeEventName, PLANE_TRIGGER_EVENTS } = await import('@/triggers/plane/utils')
    const payload = toRecord(body)
    const matchConfig =
      (providerConfig.subscriptionActivationPending === true
        ? previousPlaneDeliveryConfig(providerConfig, payload)
        : undefined) ?? providerConfig
    const eventName = planeEventName(body)
    if (!eventName) return false
    const triggerId = matchConfig.triggerId
    if (
      typeof triggerId === 'string' &&
      triggerId !== 'plane_webhook' &&
      PLANE_TRIGGER_EVENTS[triggerId] !== eventName
    )
      return false
    const workspaceId = matchConfig.workspaceId
    if (
      typeof workspaceId === 'string' &&
      workspaceId.trim() &&
      workspaceId.trim() !== payload.workspace_id
    )
      return false
    const projectId = matchConfig.projectId
    if (typeof projectId === 'string' && projectId.trim()) {
      const records = Array.isArray(payload.data)
        ? payload.data
        : [payload.data, payload.previous_attributes]
      const isProjectEvent = eventName.startsWith('project.')
      const matchesProject = records.some(
        (record) =>
          (isProjectEvent ? toRecord(record).id : recordProjectId(record)) === projectId.trim()
      )
      if (!matchesProject && !(isProjectEvent && payload.entity_id === projectId.trim()))
        return false
    }
    return true
  },

  enrichHeaders({ body }, headers) {
    headers['x-sim-idempotency-key'] = planeEventIdentifier(body)
  },

  extractIdempotencyId: planeEventIdentifier,

  async formatInput({ body, headers }) {
    const { planeEventName } = await import('@/triggers/plane/utils')
    const payload = toRecord(body)
    return {
      input: {
        version: payload.version ?? 'v1',
        event: payload.event ?? null,
        eventName: planeEventName(body),
        action: payload.action ?? null,
        event_id: payload.event_id ?? null,
        delivery_id: payload.delivery_id ?? headers['x-plane-delivery'] ?? null,
        entity_id: payload.entity_id ?? null,
        entity_type: payload.entity_type ?? null,
        webhook_id: payload.webhook_id ?? null,
        workspace_id: payload.workspace_id ?? null,
        workspace_slug: payload.workspace_slug ?? null,
        data: payload.data ?? null,
        activity: payload.activity ?? null,
        previous_attributes: payload.previous_attributes ?? null,
      },
    }
  },

  async createSubscription(ctx) {
    const config = getProviderConfig(ctx.webhook)
    if (!isProviderConfigFlagEnabled(config.autoRegister)) return undefined
    const { PLANE_TRIGGER_EVENTS } = await import('@/triggers/plane/utils')
    const event =
      typeof config.triggerId === 'string' ? PLANE_TRIGGER_EVENTS[config.triggerId] : undefined
    if (
      config.triggerId !== 'plane_webhook' &&
      (typeof config.triggerId !== 'string' ||
        !Object.hasOwn(PLANE_TRIGGER_EVENTS, config.triggerId))
    )
      throw new Error('Unknown Plane trigger for automatic registration')
    const scopes = event
      ? [event]
      : Object.values(PLANE_TRIGGER_EVENTS).filter(
          (scope) => !/^(cycle_issue|module_issue|intake_issue)\./.test(scope)
        )
    if (scopes.some((scope) => /^(cycle_issue|module_issue|intake_issue)\./.test(scope))) {
      throw new Error('This Plane v1 event requires manual webhook setup')
    }
    if (
      typeof config.externalId === 'string' &&
      config.externalId &&
      typeof config.webhookSecret === 'string' &&
      config.webhookSecret
    ) {
      const existing = await planeWebhookRequest(
        config,
        'GET',
        `${safeUrlPathSegment(config.externalId, 'webhookId')}/`
      )
      if (existing.ok) {
        const payload: unknown = await existing.json()
        if (
          isRecordLike(payload) &&
          payload.url === getNotificationUrl(ctx.webhook) &&
          Array.isArray(payload.scopes) &&
          JSON.stringify([...payload.scopes].sort()) === JSON.stringify([...scopes].sort())
        ) {
          return {
            providerConfigUpdates: {
              externalId: config.externalId,
              webhookSecret: config.webhookSecret,
              subscriptionActivationPending: payload.is_active !== true,
            },
          }
        }
        throw new Error(
          'The stored Plane webhook URL or scopes changed; update or remove it in Plane before retrying registration'
        )
      }
      if (existing.status !== 404) {
        throw new Error(`Plane webhook recovery failed (HTTP ${existing.status})`)
      }
    }
    const created = await planeWebhookRequest(config, 'POST', '', {
      name: 'Sim workflow',
      url: getNotificationUrl(ctx.webhook),
      version: 'v2',
      content_type: 'application/json',
      scopes,
      is_active: false,
    })
    if (!created.ok)
      throw new Error(
        `Plane webhook creation failed (HTTP ${created.status}). Automatic registration requires the v2 webhook API and administrator access.`
      )
    const payload: unknown = await created.json()
    if (!isRecordLike(payload) || typeof payload.id !== 'string' || !payload.id)
      throw new Error('Plane did not return a webhook ID')
    const externalId = payload.id
    const suffix = `${safeUrlPathSegment(externalId, 'webhookId')}/`
    try {
      const regenerated = await planeWebhookRequest(config, 'POST', `${suffix}regenerate/`)
      if (!regenerated.ok)
        throw new Error(`Plane webhook secret generation failed (HTTP ${regenerated.status})`)
      const secretPayload: unknown = await regenerated.json()
      if (
        !isRecordLike(secretPayload) ||
        typeof secretPayload.secret_key !== 'string' ||
        !secretPayload.secret_key
      )
        throw new Error('Plane did not return a webhook secret')
      return {
        providerConfigUpdates: {
          externalId,
          webhookSecret: secretPayload.secret_key,
          subscriptionActivationPending: true,
        },
      }
    } catch (error) {
      try {
        await deletePlaneWebhook(config, externalId)
      } catch {
        logger.warn('Plane webhook rollback failed; remove the inactive webhook in Plane settings')
      }
      throw error
    }
  },

  async activateSubscription(ctx) {
    const config = getProviderConfig(ctx.webhook)
    if (!isProviderConfigFlagEnabled(config.autoRegister)) return
    if (
      typeof config.externalId !== 'string' ||
      !config.externalId ||
      typeof config.webhookSecret !== 'string' ||
      !config.webhookSecret
    )
      throw new Error('Plane webhook ID and signing secret must be persisted before activation')
    const activated = await planeWebhookRequest(
      config,
      'PATCH',
      `${safeUrlPathSegment(config.externalId, 'webhookId')}/`,
      { is_active: true }
    )
    if (!activated.ok) throw new Error(`Plane webhook activation failed (HTTP ${activated.status})`)
  },

  async deleteSubscription(ctx) {
    const config = getProviderConfig(ctx.webhook)
    if (!isProviderConfigFlagEnabled(config.autoRegister)) return
    try {
      if (typeof config.externalId !== 'string' || !config.externalId) {
        if (ctx.strict) throw new Error('Plane webhook ID is missing during cleanup')
        return
      }
      await deletePlaneWebhook(config, config.externalId)
    } catch (error) {
      logger.warn('Plane webhook cleanup failed', { error: getErrorMessage(error) })
      if (ctx.strict) throw error
    }
  },
}
