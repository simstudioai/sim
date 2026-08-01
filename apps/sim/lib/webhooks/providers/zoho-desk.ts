import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import * as jose from 'jose'
import { NextResponse } from 'next/server'
import { getCredentialOwner, getNotificationUrl } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { withDerivedContentText } from '@/tools/zoho_desk/utils'

const logger = createLogger('WebhookProvider:ZohoDesk')

const DEFAULT_ZOHO_DESK_BASE = 'https://desk.zoho.com'
// Stop at a comma or whitespace: better-auth persists Zoho's scopes comma-joined
// (no spaces), so a greedy `\S+` would swallow the whole scope list into the host.
const ZOHO_DESK_BASE_URL_REGEX = /__zoho_domain__:([^\s,]+)/

/**
 * Remote JWKS sets are cached per Desk data-center host. `createRemoteJWKSet`
 * caches keys and coalesces refetches internally, so a module-scoped cache keeps
 * verification within Zoho's 5-second delivery deadline.
 */
const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()
function getJwks(deskHost: string): ReturnType<typeof jose.createRemoteJWKSet> {
  let set = jwksCache.get(deskHost)
  if (!set) {
    set = jose.createRemoteJWKSet(new URL(`https://${deskHost}/.well-known/jwks.json`))
    jwksCache.set(deskHost, set)
  }
  return set
}

/** Read the persisted data-center Desk base URL from the credential's scope marker. */
async function resolveZohoDeskApiDomain(accountId: string): Promise<string> {
  try {
    const rows = await db
      .select({ scope: account.scope })
      .from(account)
      .where(eq(account.id, accountId))
      .limit(1)
    const scope = rows[0]?.scope
    const match = typeof scope === 'string' ? scope.match(ZOHO_DESK_BASE_URL_REGEX) : null
    return match?.[1] ?? DEFAULT_ZOHO_DESK_BASE
  } catch (error) {
    logger.warn('Failed to resolve Zoho Desk api domain from credential', {
      message: toError(error).message,
    })
    return DEFAULT_ZOHO_DESK_BASE
  }
}

function splitCsv(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** Error carrying an HTTP status so the deploy outbox can classify retryability. */
function statusError(message: string, status: number): Error {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

/** Zoho errorCode / message patterns that genuinely indicate a permission or edition denial. */
const ZOHO_EDITION_PERMISSION_PATTERN =
  /permission|not\s+(allowed|permitted|supported)|edition|upgrade|feature/i

/**
 * Map a Zoho Desk webhook-creation failure to an actionable error that surfaces
 * Zoho's real errorCode / message / field errors instead of a catch-all. The
 * returned error carries an HTTP `status`: permanent client failures (4xx -
 * invalid data, permission, unprocessable) keep their 4xx so the deploy outbox
 * fails the deploy terminally (NonRetryableDeploymentError) with the true
 * reason; rate limits and provider 5xx map to 5xx so they stay retryable.
 */
export function mapZohoWebhookError(status: number, bodyText: string): Error {
  let errorCode: string | undefined
  let message: string | undefined
  let fieldErrors: string[] = []
  try {
    const parsed = JSON.parse(bodyText) as {
      errorCode?: unknown
      message?: unknown
      errors?: Array<{ fieldName?: unknown; errorMessage?: unknown }>
    }
    if (typeof parsed.errorCode === 'string') errorCode = parsed.errorCode
    if (typeof parsed.message === 'string') message = parsed.message
    if (Array.isArray(parsed.errors)) {
      fieldErrors = parsed.errors
        .map((e) =>
          typeof e?.errorMessage === 'string'
            ? typeof e.fieldName === 'string'
              ? `${e.fieldName}: ${e.errorMessage}`
              : e.errorMessage
            : undefined
        )
        .filter((v): v is string => Boolean(v))
    }
  } catch {
    // non-JSON body
  }

  const detail =
    fieldErrors.length > 0
      ? fieldErrors.join('; ')
      : message || truncate(bodyText, 200) || `HTTP ${status}`
  const codePrefix = errorCode ? `${errorCode}: ` : ''
  let realMessage = `Zoho Desk webhook creation failed (HTTP ${status}) - ${codePrefix}${detail}`

  // Only claim the edition/permission cause when Zoho's own errorCode or message
  // says so. A bare 403 can equally mean a wrong org, a missing scope, or a bad
  // token, and those must not get the misleading "requires Professional" suffix.
  const indicatesEditionOrPermission =
    (errorCode ? ZOHO_EDITION_PERMISSION_PATTERN.test(errorCode) : false) ||
    ZOHO_EDITION_PERMISSION_PATTERN.test(detail)
  if (indicatesEditionOrPermission) {
    realMessage +=
      ' (Zoho Desk webhooks require a Professional edition or higher and the Desk.webhooks.CREATE scope.)'
  }

  // Rate limits and provider-side 5xx are transient -> keep retryable.
  if (status === 429 || status >= 500) {
    return statusError(realMessage, 503)
  }
  // Other client errors cannot succeed on retry -> carry the 4xx status.
  return statusError(realMessage, status >= 400 && status < 500 ? status : 422)
}

export const zohoDeskHandler: WebhookProviderHandler = {
  // Zoho requires a 200 within 5 seconds, so acknowledge ingress before running
  // the workflow through the durable queue rather than inline.
  executionMode: 'queue',

  async createSubscription({
    webhook: webhookRecord,
    userId,
    requestId,
  }: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = ((webhookRecord as Record<string, unknown>).providerConfig ?? {}) as Record<
      string,
      unknown
    >
    const credentialId = typeof config.credentialId === 'string' ? config.credentialId : undefined
    const orgId = typeof config.orgId === 'string' ? config.orgId : undefined
    const eventType = typeof config.eventType === 'string' ? config.eventType : undefined

    // Missing configuration is permanent - carry a 4xx so the deploy outbox fails
    // terminally (NonRetryableDeploymentError) instead of retrying a create that
    // can never succeed without the user fixing the trigger config.
    if (!orgId) {
      throw statusError(
        'Zoho Desk Organization ID is required to create the webhook subscription.',
        400
      )
    }
    if (!eventType) {
      throw statusError(
        'A Zoho Desk event type is required to create the webhook subscription.',
        400
      )
    }

    const owner = credentialId ? await getCredentialOwner(credentialId, requestId) : null
    const accessToken = owner
      ? await refreshAccessTokenIfNeeded(owner.accountId, owner.userId, requestId)
      : null
    if (!accessToken || !owner) {
      throw statusError(
        'Zoho Desk account connection required. Please connect your Zoho Desk account in the trigger configuration and try again.',
        400
      )
    }

    const apiDomain = await resolveZohoDeskApiDomain(owner.accountId)
    const notificationUrl = getNotificationUrl(webhookRecord)

    const filter: Record<string, unknown> = {}
    const departmentIds = splitCsv(config.departmentIds)
    if (departmentIds.length > 0) filter.departmentIds = departmentIds
    if (eventType === 'Ticket_Update') {
      filter.includePrevState = true
      const fields = splitCsv(config.fields).slice(0, 5)
      if (fields.length > 0) filter.fields = fields
    }
    if (eventType === 'Ticket_Thread_Add') {
      const direction = typeof config.direction === 'string' ? config.direction : 'both'
      if (direction === 'in' || direction === 'out') filter.direction = direction
    }

    const response = await fetch(`${apiDomain}/api/v1/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      // Zoho's ignoreSourceId only accepts a genuine Zoho source id, not an
      // arbitrary UUID (it rejects one with INVALID_DATA), so it is omitted.
      body: JSON.stringify({
        url: notificationUrl,
        name: `sim-${webhookRecord.id}`.slice(0, 50),
        subscriptions: { [eventType]: filter },
        isEnabled: true,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    const bodyText = await response.text()
    if (!response.ok) {
      logger.error(`[${requestId}] Failed to create Zoho Desk webhook`, {
        status: response.status,
        body: truncate(bodyText, 500),
      })
      throw mapZohoWebhookError(response.status, bodyText)
    }

    let created: Record<string, unknown> = {}
    try {
      created = JSON.parse(bodyText)
    } catch {
      // Zoho returns JSON on success; tolerate an empty body.
    }
    const idValue = created.id
    const externalId =
      typeof idValue === 'string' ? idValue : typeof idValue === 'number' ? String(idValue) : ''
    // Never persist a subscription without its id: the id is the JWT `aud` claim
    // verifyAuth checks, so an empty one would force verification to fail open.
    if (!externalId) {
      // Zoho reported success but gave no id: a webhook may have been created and
      // is unidentifiable, so retrying risks duplicates. Fail terminally (4xx).
      throw statusError('Zoho Desk webhook creation succeeded but returned no webhook id', 422)
    }

    logger.info(`[${requestId}] Created Zoho Desk webhook`, { externalId })
    return {
      // externalId (the JWT `aud` claim) and apiDomain are provider-managed and
      // are SYSTEM_MANAGED_FIELDS, so they are excluded from the redeploy config
      // diff to avoid delete/recreate churn on every deploy.
      providerConfigUpdates: { externalId, apiDomain },
    }
  },

  async deleteSubscription({
    webhook: webhookRecord,
    requestId,
    strict,
  }: DeleteSubscriptionContext): Promise<void> {
    const config = ((webhookRecord as Record<string, unknown>).providerConfig ?? {}) as Record<
      string,
      unknown
    >
    const externalId = typeof config.externalId === 'string' ? config.externalId : undefined
    const orgId = typeof config.orgId === 'string' ? config.orgId : undefined
    const credentialId = typeof config.credentialId === 'string' ? config.credentialId : undefined

    if (!externalId || !orgId) {
      if (strict) throw new Error('Missing Zoho Desk webhook identifiers for deletion')
      return
    }

    const owner = credentialId ? await getCredentialOwner(credentialId, requestId) : null
    const accessToken = owner
      ? await refreshAccessTokenIfNeeded(owner.accountId, owner.userId, requestId)
      : null
    if (!accessToken || !owner) {
      if (strict) throw new Error('Missing Zoho Desk token for webhook deletion')
      return
    }

    const apiDomain =
      (typeof config.apiDomain === 'string' && config.apiDomain) ||
      (await resolveZohoDeskApiDomain(owner.accountId))

    const response = await fetch(`${apiDomain}/api/v1/webhooks/${externalId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok && response.status !== 404) {
      logger.warn(`[${requestId}] Failed to delete Zoho Desk webhook`, { status: response.status })
      if (strict) throw new Error(`Zoho Desk webhook delete failed: ${response.status}`)
    }
  },

  async verifyAuth({
    request,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> {
    const token = request.headers.get('x-zdesk-jwt')
    if (!token) {
      logger.warn(`[${requestId}] Zoho Desk webhook missing X-ZDesk-JWT header`)
      return new NextResponse('Unauthorized - Missing Zoho Desk JWT', { status: 401 })
    }

    const orgId = typeof providerConfig.orgId === 'string' ? providerConfig.orgId : ''
    // `webhookId` was persisted on older rows; `externalId` is the canonical id.
    const webhookId =
      (typeof providerConfig.externalId === 'string' && providerConfig.externalId) ||
      (typeof providerConfig.webhookId === 'string' && providerConfig.webhookId) ||
      ''
    // Fail closed: without both identifiers we cannot bind the JWT to this
    // subscription, so accepting any org-JWKS RS256 token matching only the
    // issuer would be a verification bypass. Reject instead of skipping a claim.
    if (!orgId || !webhookId) {
      logger.warn(`[${requestId}] Zoho Desk webhook missing orgId/webhookId; rejecting`)
      return new NextResponse('Unauthorized - webhook not fully provisioned', { status: 401 })
    }

    // Prefer the apiDomain persisted on the webhook row (fast path, no DB hit on
    // the 5s-deadline verification path). Only when it is absent - older rows, or
    // a config that never captured it - fall back to the Desk base stored on the
    // OAuth credential (`__zoho_domain__` scope marker), mirroring
    // deleteSubscription, so a non-US org verifies against its own JWKS rather
    // than defaulting to the US host and rejecting legitimate events.
    let apiDomain =
      typeof providerConfig.apiDomain === 'string' && providerConfig.apiDomain
        ? providerConfig.apiDomain
        : ''
    if (!apiDomain) {
      const credentialId =
        typeof providerConfig.credentialId === 'string' ? providerConfig.credentialId : undefined
      const owner = credentialId ? await getCredentialOwner(credentialId, requestId) : null
      apiDomain = owner ? await resolveZohoDeskApiDomain(owner.accountId) : DEFAULT_ZOHO_DESK_BASE
    }

    let deskHost: string
    try {
      deskHost = new URL(apiDomain).host
    } catch {
      deskHost = 'desk.zoho.com'
    }

    try {
      await jose.jwtVerify(token, getJwks(deskHost), {
        algorithms: ['RS256'],
        issuer: `orgId:${orgId}`,
        audience: `webhookId:${webhookId}`,
      })
      return null
    } catch (error) {
      logger.warn(`[${requestId}] Zoho Desk JWT verification failed`, {
        message: toError(error).message,
      })
      return new NextResponse('Unauthorized - Invalid Zoho Desk JWT', { status: 401 })
    }
  },

  async formatInput({ body, requestId }: FormatInputContext): Promise<FormatInputResult> {
    // Zoho Desk delivers an array of events: [{ payload, prevState, eventTime, eventType, orgId }].
    // Anything that is not the expected array shape is passed through unchanged.
    if (!Array.isArray(body)) {
      return { input: body }
    }
    // Zoho fires one event per notification (single-element array). Log rather
    // than silently drop if that ever changes, so batched deliveries are visible.
    if (body.length > 1) {
      logger.warn(
        `[${requestId}] Zoho Desk delivered ${body.length} events in one payload; processing the first only`
      )
    }
    const event = body[0]
    if (!event || typeof event !== 'object') {
      return { input: body }
    }
    const record = event as Record<string, unknown>
    // Comment / thread event payloads carry a raw `content` + `contentType`
    // ('html' | 'plainText') pair; augment both `payload` and `prevState` with a
    // derived plain-text `contentText` (HTML stripped) alongside the untouched raw
    // content, so before/after comparisons see a consistent shape. Values without
    // a content pair (ticket / contact events) pass through unchanged.
    return {
      input: {
        eventType: record.eventType ?? null,
        eventTime: record.eventTime ?? null,
        orgId: record.orgId ?? null,
        payload: record.payload != null ? withDerivedContentText(record.payload) : null,
        prevState: record.prevState != null ? withDerivedContentText(record.prevState) : null,
      },
    }
  },
}
