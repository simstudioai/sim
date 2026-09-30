import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { NextResponse } from 'next/server'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import {
  buildFallbackDeliveryFingerprint,
  createHmacVerifier,
} from '@/lib/webhooks/providers/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('WebhookProvider:PlanetScale')
const MANAGEMENT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

async function validatePlanetScaleSignature(
  encrypted: string,
  signature: string,
  rawBody: string
): Promise<boolean> {
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) return false
  try {
    const { decrypted } = await decryptSecret(encrypted, { logFailure: false })
    return !!decrypted && safeCompare(hmacSha256Hex(rawBody, decrypted), signature.toLowerCase())
  } catch {
    return false
  }
}

function requiredValue(config: Record<string, unknown>, key: string): string {
  const value = config[key]
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\r\n]/.test(value) ||
    value.includes('{{') ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(
      'PlanetScale service token credentials, organization and database are required. Resolve environment references before registration.'
    )
  }
  return value
}

function managementContext(config: Record<string, unknown>) {
  const id = requiredValue(config, 'triggerServiceTokenId')
  const token = requiredValue(config, 'triggerServiceToken')
  if (id.includes(':') || token.includes(':'))
    throw new Error('Invalid PlanetScale service token credentials.')
  const organization = requiredValue(config, 'triggerOrganization')
  const database = requiredValue(config, 'database')
  return {
    url: `https://api.planetscale.com/v1/organizations/${safeUrlPathSegment(organization, 'organization')}/databases/${safeUrlPathSegment(database, 'database')}/webhooks`,
    authorization: `${id}:${token}`,
  }
}

class PlanetScaleManagementError extends Error {}

function managementFailure(status?: number): Error {
  if (status === 401)
    return new PlanetScaleManagementError(
      'PlanetScale authentication failed. Check the service token ID and token.'
    )
  if (status === 403)
    return new PlanetScaleManagementError(
      'PlanetScale access denied. Grant read_database and write_database permissions for this database.'
    )
  if (status === 422)
    return new PlanetScaleManagementError(
      'PlanetScale rejected the webhook configuration. Check the events, HTTPS callback and five-webhook limit.'
    )
  return new PlanetScaleManagementError(
    status === undefined
      ? 'PlanetScale webhook management request failed.'
      : `PlanetScale webhook management request failed (HTTP ${status}).`
  )
}

async function managementRequest(
  config: Record<string, unknown>,
  method: 'GET' | 'POST' | 'DELETE',
  externalId?: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const context = managementContext(config)
  const signal = AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS)
  try {
    const response = await fetch(
      `${context.url}${externalId ? `/${safeUrlPathSegment(externalId, 'webhook ID')}` : ''}`,
      {
        method,
        redirect: 'error',
        headers: {
          Authorization: context.authorization,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      }
    )
    if (response.status === 404 || (method === 'DELETE' && response.status === 204)) {
      await response.body?.cancel()
      return { status: response.status, data: {} }
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw managementFailure(response.status)
    }
    if (method === 'DELETE') {
      await response.body?.cancel()
      throw managementFailure(response.status)
    }
    const data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label: 'PlanetScale webhook management response',
      signal,
    })
    if (!isRecordLike(data)) throw managementFailure()
    return { status: response.status, data }
  } catch (error) {
    if (error instanceof PlanetScaleManagementError) throw error
    throw managementFailure()
  }
}

async function secretUpdates(data: Record<string, unknown>): Promise<SubscriptionResult> {
  if (typeof data.id !== 'string' || !data.id.trim())
    throw new Error('PlanetScale webhook response has no valid ID.')
  safeUrlPathSegment(data.id, 'webhook ID')
  if (typeof data.secret !== 'string' || !data.secret.trim())
    throw new Error('PlanetScale webhook response has no signing secret.')
  const { encrypted } = await encryptSecret(data.secret)
  return { providerConfigUpdates: { externalId: data.id, webhookSecret: encrypted } }
}

function projectResource(
  resource: Record<string, unknown>,
  triggerId: unknown
): Record<string, unknown> {
  if (triggerId === 'planetscale_webhook') return resource
  const identity = {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    state: toStringOrNull(resource.state),
    createdAt: toStringOrNull(resource.created_at),
    updatedAt: toStringOrNull(resource.updated_at),
  }
  if (typeof triggerId === 'string' && triggerId.startsWith('planetscale_branch_'))
    return {
      ...identity,
      ready: toBooleanOrNull(resource.ready),
      production: toBooleanOrNull(resource.production),
      safeMigrations: toBooleanOrNull(resource.safe_migrations),
      parentBranch: toStringOrNull(resource.parent_branch),
      htmlUrl: toStringOrNull(resource.html_url),
    }
  if (typeof triggerId === 'string' && triggerId.startsWith('planetscale_backup_')) {
    const branch = toRecord(resource.database_branch)
    return {
      ...identity,
      size: toNumberOrNull(resource.size),
      protected: toBooleanOrNull(resource.protected),
      startedAt: toStringOrNull(resource.started_at),
      completedAt: toStringOrNull(resource.completed_at),
      expiresAt: toStringOrNull(resource.expires_at),
      branch: { id: toStringOrNull(branch.id), name: toStringOrNull(branch.name) },
    }
  }
  return {
    id: identity.id,
    state: identity.state,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
    number: toNumberOrNull(resource.number),
    branch: toStringOrNull(resource.branch),
    intoBranch: toStringOrNull(resource.into_branch),
    deploymentState: toStringOrNull(resource.deployment_state),
    approved: toBooleanOrNull(resource.approved),
    numComments: toNumberOrNull(resource.num_comments),
    notes: toStringOrNull(resource.notes),
    closedAt: toStringOrNull(resource.closed_at),
    deployedAt: toStringOrNull(resource.deployed_at),
    htmlUrl: toStringOrNull(resource.html_url),
  }
}

export const planetscaleHandler: WebhookProviderHandler = {
  executionMode: 'queue',
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-PlanetScale-Signature',
    requireSecret: true,
    providerLabel: 'PlanetScale',
    validateFn: validatePlanetScaleSignature,
  }),

  handleReachabilityTest(body) {
    return toRecord(body).event === 'webhook.test'
      ? NextResponse.json({ message: 'PlanetScale webhook test acknowledged' })
      : null
  },

  async matchEvent({ body, providerConfig }): Promise<boolean> {
    const event = toRecord(body).event
    if (typeof event !== 'string' || event === 'webhook.test') return false
    const { getPlanetScaleEvents } = await import('@/triggers/planetscale/utils')
    try {
      return getPlanetScaleEvents(providerConfig).includes(event)
    } catch {
      return false
    }
  },

  /** Retain signed native event time to distinguish repeated resource snapshots; no receipt time is added. */
  extractIdempotencyId(body) {
    return `planetscale:${buildFallbackDeliveryFingerprint(body)}`
  },

  enrichHeaders({ body }, headers) {
    headers['x-sim-idempotency-key'] = `planetscale:${buildFallbackDeliveryFingerprint(body)}`
  },

  async formatInput({ body, webhook }) {
    if (
      !isRecordLike(body) ||
      typeof body.event !== 'string' ||
      !Number.isSafeInteger(body.timestamp) ||
      typeof body.organization !== 'string' ||
      typeof body.database !== 'string' ||
      !isRecordLike(body.resource)
    ) {
      throw new Error('Invalid PlanetScale webhook payload.')
    }
    return {
      input: {
        event: body.event,
        timestamp: body.timestamp,
        organization: body.organization,
        database: body.database,
        resource: projectResource(body.resource, getProviderConfig(webhook).triggerId),
        payload: body,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult> {
    const config = getProviderConfig(ctx.webhook)
    const { getPlanetScaleEvents } = await import('@/triggers/planetscale/utils')
    const events = getPlanetScaleEvents(config)
    const callback = getNotificationUrl(ctx.webhook)
    if (config.externalId !== undefined && config.externalId !== null) {
      const externalId = requiredValue(config, 'externalId')
      const existing = await managementRequest(config, 'GET', externalId)
      if (existing.status !== 404) {
        const data = existing.data
        if (
          data.id !== externalId ||
          data.url !== callback ||
          data.enabled !== true ||
          !Array.isArray(data.events) ||
          data.events.length !== events.length ||
          !events.every((event) => (data.events as unknown[]).includes(event))
        ) {
          throw new Error(
            'PlanetScale recorded webhook does not match this registration. Check its callback, events and enabled state.'
          )
        }
        try {
          return await secretUpdates(data)
        } catch {
          throw new Error('PlanetScale recorded webhook has no usable signing secret.')
        }
      }
    }
    const { data, status } = await managementRequest(config, 'POST', undefined, {
      url: callback,
      enabled: true,
      events,
    })
    if (status === 404) throw managementFailure(status)
    try {
      return await secretUpdates(data)
    } catch {
      if (
        typeof data.id === 'string' &&
        data.id.trim() &&
        data.id.trim() !== '.' &&
        data.id.trim() !== '..'
      )
        await managementRequest(config, 'DELETE', data.id)
      throw new Error('PlanetScale webhook creation did not return usable signing state.')
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const externalId = requiredValue(config, 'externalId')
      await managementRequest(config, 'DELETE', externalId)
    } catch {
      if (ctx.strict)
        throw new Error('PlanetScale webhook deletion failed. Check credentials and retry cleanup.')
      logger.warn(`[${ctx.requestId}] PlanetScale webhook cleanup failed`)
    }
  },
}
