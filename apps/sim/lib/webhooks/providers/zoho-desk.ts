import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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

const logger = createLogger('WebhookProvider:ZohoDesk')

const DEFAULT_ZOHO_DESK_BASE = 'https://desk.zoho.com'
const ZOHO_DESK_BASE_URL_REGEX = /__zoho_domain__:(\S+)/

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

/** Map a Zoho Desk webhook-creation failure to a loud, actionable error. */
function mapZohoWebhookError(status: number, bodyText: string): Error {
  let errorCode: string | undefined
  try {
    const parsed = JSON.parse(bodyText)
    if (parsed && typeof parsed.errorCode === 'string') errorCode = parsed.errorCode
  } catch {
    // non-JSON body
  }
  if (status === 403 || status === 422) {
    if (errorCode === 'MAX_COUNT_EXCEEDED' || /limit|max/i.test(bodyText)) {
      return new Error(
        'Zoho Desk webhook limit reached for this edition. Disable an existing webhook and try again.'
      )
    }
    return new Error(
      'Zoho Desk webhooks require a Professional edition or higher. Free and Standard editions cannot create webhooks.'
    )
  }
  return new Error(
    `Failed to create Zoho Desk webhook (HTTP ${status}): ${truncate(bodyText, 200)}`
  )
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

    if (!orgId) {
      throw new Error('Zoho Desk Organization ID is required to create the webhook subscription.')
    }
    if (!eventType) {
      throw new Error('A Zoho Desk event type is required to create the webhook subscription.')
    }

    const owner = credentialId ? await getCredentialOwner(credentialId, requestId) : null
    const accessToken = owner
      ? await refreshAccessTokenIfNeeded(owner.accountId, owner.userId, requestId)
      : null
    if (!accessToken || !owner) {
      throw new Error(
        'Zoho Desk account connection required. Please connect your Zoho Desk account in the trigger configuration and try again.'
      )
    }

    const apiDomain = await resolveZohoDeskApiDomain(owner.accountId)
    const notificationUrl = getNotificationUrl(webhookRecord)
    const ignoreSourceId =
      typeof config.ignoreSourceId === 'string' && config.ignoreSourceId
        ? config.ignoreSourceId
        : generateId()

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
      body: JSON.stringify({
        url: notificationUrl,
        name: `sim-${webhookRecord.id}`.slice(0, 50),
        subscriptions: { [eventType]: filter },
        ignoreSourceId,
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
    const externalId = typeof created.id === 'string' ? created.id : String(created.id ?? '')

    logger.info(`[${requestId}] Created Zoho Desk webhook`, { externalId })
    return {
      providerConfigUpdates: { externalId, webhookId: externalId, ignoreSourceId, apiDomain },
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
    const webhookId =
      (typeof providerConfig.webhookId === 'string' && providerConfig.webhookId) ||
      (typeof providerConfig.externalId === 'string' && providerConfig.externalId) ||
      ''
    const apiDomain =
      typeof providerConfig.apiDomain === 'string'
        ? providerConfig.apiDomain
        : DEFAULT_ZOHO_DESK_BASE

    let deskHost: string
    try {
      deskHost = new URL(apiDomain).host
    } catch {
      deskHost = 'desk.zoho.com'
    }

    try {
      await jose.jwtVerify(token, getJwks(deskHost), {
        algorithms: ['RS256'],
        ...(orgId ? { issuer: `orgId:${orgId}` } : {}),
        ...(webhookId ? { audience: `webhookId:${webhookId}` } : {}),
      })
      return null
    } catch (error) {
      logger.warn(`[${requestId}] Zoho Desk JWT verification failed`, {
        message: toError(error).message,
      })
      return new NextResponse('Unauthorized - Invalid Zoho Desk JWT', { status: 401 })
    }
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    // Zoho Desk delivers an array of events: [{ payload, prevState, eventTime, eventType, orgId }].
    // Anything that is not the expected array shape is passed through unchanged.
    if (!Array.isArray(body)) {
      return { input: body }
    }
    const event = body[0]
    if (!event || typeof event !== 'object') {
      return { input: body }
    }
    const record = event as Record<string, unknown>
    return {
      input: {
        eventType: record.eventType ?? null,
        eventTime: record.eventTime ?? null,
        orgId: record.orgId ?? null,
        payload: record.payload ?? null,
        prevState: record.prevState ?? null,
      },
    }
  },
}
