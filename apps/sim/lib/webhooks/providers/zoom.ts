import { db, webhook, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { resolveEnvVarsInObject } from '@/lib/webhooks/env-resolver'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Zoom')

/**
 * Validate Zoom webhook signature using HMAC-SHA256.
 * Zoom sends `x-zm-signature` as `v0=<hex>` and `x-zm-request-timestamp`.
 * The message to hash is `v0:{timestamp}:{rawBody}`.
 */
/** Exported for tests — Zoom signs `v0:{timestamp}:{rawBody}`. */
export function validateZoomSignature(
  secretToken: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  try {
    if (!secretToken || !signature || !timestamp || !body) {
      return false
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const requestSeconds = Number.parseInt(timestamp, 10)
    if (Number.isNaN(requestSeconds) || Math.abs(nowSeconds - requestSeconds) > 300) {
      return false
    }

    const message = `v0:${timestamp}:${body}`
    const computedHash = hmacSha256Hex(message, secretToken)
    const expectedSignature = `v0=${computedHash}`

    return safeCompare(expectedSignature, signature)
  } catch (err) {
    logger.error('Zoom signature validation error', err)
    return false
  }
}

async function resolveZoomChallengeSecrets(
  path: string,
  requestId: string
): Promise<Array<{ secretToken: string }>> {
  const rows = await db
    .select({
      providerConfig: webhook.providerConfig,
      userId: workflow.userId,
      workspaceId: workflow.workspaceId,
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(eq(webhook.path, path), eq(webhook.provider, 'zoom'), eq(webhook.isActive, true)))

  const resolvedRows = await Promise.all(
    rows.map(async (row) => {
      const rawConfig =
        row.providerConfig &&
        typeof row.providerConfig === 'object' &&
        !Array.isArray(row.providerConfig)
          ? (row.providerConfig as Record<string, unknown>)
          : {}

      try {
        const config = await resolveEnvVarsInObject(
          rawConfig,
          row.userId,
          row.workspaceId ?? undefined
        )
        const secretToken = typeof config.secretToken === 'string' ? config.secretToken : ''
        return { secretToken }
      } catch (error) {
        logger.warn(`[${requestId}] Failed to resolve Zoom webhook secret for challenge`, {
          error: toError(error).message,
          path,
        })
        return { secretToken: '' }
      }
    })
  )

  return resolvedRows.filter((row) => row.secretToken)
}

export const zoomHandler: WebhookProviderHandler = {
  /**
   * Zoom delivers the standard app webhook envelope (`event`, `event_ts`, `payload`).
   * Pass through unchanged so trigger outputs match runtime input.
   */
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },

  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    const secretToken = providerConfig.secretToken as string | undefined
    if (!secretToken) {
      logger.warn(
        `[${requestId}] Zoom webhook missing secretToken in providerConfig — rejecting request`
      )
      return new NextResponse('Unauthorized - Zoom secret token not configured', { status: 401 })
    }

    const signature = request.headers.get('x-zm-signature')
    const timestamp = request.headers.get('x-zm-request-timestamp')

    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Zoom webhook missing signature or timestamp header`)
      return new NextResponse('Unauthorized - Missing Zoom signature', { status: 401 })
    }

    if (!validateZoomSignature(secretToken, signature, timestamp, rawBody)) {
      logger.warn(`[${requestId}] Zoom webhook signature verification failed`)
      return new NextResponse('Unauthorized - Invalid Zoom signature', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook: wh, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>
    const event = typeof obj.event === 'string' ? obj.event : ''

    if (event === 'endpoint.url_validation') {
      return false
    }

    if (triggerId) {
      const { isZoomEventMatch } = await import('@/triggers/zoom/utils')
      if (!isZoomEventMatch(triggerId, event)) {
        logger.debug(
          `[${requestId}] Zoom event mismatch for trigger ${triggerId}. Event: ${event}. Skipping execution.`,
          {
            webhookId: wh.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: event,
          }
        )
        return false
      }
    }

    return true
  },

  /**
   * Handle Zoom endpoint URL validation challenges.
   * Zoom sends an `endpoint.url_validation` event with a `plainToken` that must
   * be hashed with the app's secret token and returned alongside the original token.
   */
  async handleChallenge(
    body: unknown,
    request: NextRequest,
    requestId: string,
    path: string,
    rawBody?: string
  ) {
    const obj = body as Record<string, unknown> | null
    if (obj?.event !== 'endpoint.url_validation') {
      return null
    }

    const payload = obj.payload as Record<string, unknown> | undefined
    const plainToken = payload?.plainToken as string | undefined
    if (!plainToken) {
      return null
    }

    logger.info(`[${requestId}] Zoom URL validation request received for path: ${path}`)

    const signature = request.headers.get('x-zm-signature')
    const timestamp = request.headers.get('x-zm-request-timestamp')
    if (!signature || !timestamp) {
      logger.warn(`[${requestId}] Zoom challenge request missing signature headers — rejecting`)
      return null
    }

    const bodyForSignature =
      rawBody !== undefined && rawBody !== null ? rawBody : JSON.stringify(body)

    let rows: Array<{ secretToken: string }> = []
    try {
      rows = await resolveZoomChallengeSecrets(path, requestId)
    } catch (err) {
      logger.warn(`[${requestId}] Failed to look up webhook secret for Zoom validation`, err)
      return null
    }

    for (const row of rows) {
      const secretToken = row.secretToken
      if (
        secretToken &&
        validateZoomSignature(secretToken, signature, timestamp, bodyForSignature)
      ) {
        const hashForValidate = hmacSha256Hex(plainToken, secretToken)

        return NextResponse.json({
          plainToken,
          encryptedToken: hashForValidate,
        })
      }
    }

    logger.warn(
      `[${requestId}] Zoom challenge: no matching secret for path ${path} (${rows.length} webhook row(s))`
    )
    return null
  },
}
