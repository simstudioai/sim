import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
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
    const secret = (providerConfig.signatureSecret as string | undefined)?.trim()
    if (!secret) {
      logger.warn(`[${requestId}] Netlify signature secret missing; rejecting delivery`)
      return new NextResponse(
        'Unauthorized - Netlify signature secret is not configured. Set the JWS secret token on this trigger.',
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
