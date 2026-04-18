import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import * as jose from 'jose'
import { NextResponse } from 'next/server'
import { toError } from '@/lib/core/utils/helpers'
import type {
  AuthContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:Gong')

/** providerConfig key: PEM or raw base64 RSA public key from Gong (Signed JWT header auth). */
export const GONG_JWT_PUBLIC_KEY_CONFIG_KEY = 'gongJwtPublicKeyPem'

/**
 * Gong automation webhooks support either URL secrecy (token in path) or a signed JWT in
 * `Authorization` (see https://help.gong.io/docs/create-a-webhook-rule).
 * When {@link GONG_JWT_PUBLIC_KEY_CONFIG_KEY} is set, we verify RS256 per Gong's JWT guide.
 * When unset, only the unguessable Sim webhook path authenticates the request (same as before).
 */
export function normalizeGongPublicKeyPem(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return trimmed
  }
  const b64 = trimmed.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) {
    return null
  }
  const chunked = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return `-----BEGIN PUBLIC KEY-----\n${chunked}\n-----END PUBLIC KEY-----`
}

function normalizeUrlForGongJwtClaim(url: string): string {
  try {
    const u = new URL(url)
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host.toLowerCase()}${path}`
  } catch {
    return url.trim()
  }
}

function parseAuthorizationJwt(authHeader: string | null): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim() || null
  }
  return trimmed || null
}

export async function verifyGongJwtAuth(ctx: AuthContext): Promise<NextResponse | null> {
  const { request, rawBody, requestId, providerConfig } = ctx
  const rawKey = providerConfig[GONG_JWT_PUBLIC_KEY_CONFIG_KEY]
  if (typeof rawKey !== 'string') {
    return null
  }

  const pem = normalizeGongPublicKeyPem(rawKey)
  if (!pem) {
    logger.warn(`[${requestId}] Gong JWT public key configured but could not be normalized`)
    return new NextResponse('Unauthorized - Invalid Gong JWT public key configuration', {
      status: 401,
    })
  }

  const token = parseAuthorizationJwt(request.headers.get('authorization'))
  if (!token) {
    logger.warn(`[${requestId}] Gong JWT verification enabled but Authorization header missing`)
    return new NextResponse('Unauthorized - Missing Gong JWT', { status: 401 })
  }

  let payload: jose.JWTPayload
  try {
    const key = await jose.importSPKI(pem, 'RS256')
    const verified = await jose.jwtVerify(token, key, { algorithms: ['RS256'] })
    payload = verified.payload
  } catch (error) {
    logger.warn(`[${requestId}] Gong JWT verification failed`, {
      message: toError(error).message,
    })
    return new NextResponse('Unauthorized - Invalid Gong JWT', { status: 401 })
  }

  const claimUrl = payload.webhook_url
  if (typeof claimUrl !== 'string' || !claimUrl) {
    logger.warn(`[${requestId}] Gong JWT missing webhook_url claim`)
    return new NextResponse('Unauthorized - Invalid Gong JWT claims', { status: 401 })
  }

  const claimDigest = payload.body_sha256
  if (typeof claimDigest !== 'string' || !claimDigest) {
    logger.warn(`[${requestId}] Gong JWT missing body_sha256 claim`)
    return new NextResponse('Unauthorized - Invalid Gong JWT claims', { status: 401 })
  }

  const expectedDigest = createHash('sha256').update(rawBody, 'utf8').digest('hex')
  if (claimDigest !== expectedDigest) {
    logger.warn(`[${requestId}] Gong JWT body_sha256 mismatch`)
    return new NextResponse('Unauthorized - Gong JWT body mismatch', { status: 401 })
  }

  const receivedNorm = normalizeUrlForGongJwtClaim(request.url)
  const claimNorm = normalizeUrlForGongJwtClaim(claimUrl)
  if (receivedNorm !== claimNorm) {
    logger.warn(`[${requestId}] Gong JWT webhook_url mismatch`, {
      receivedNorm,
      claimNorm,
    })
    return new NextResponse('Unauthorized - Gong JWT URL mismatch', { status: 401 })
  }

  return null
}

export const gongHandler: WebhookProviderHandler = {
  verifyAuth: verifyGongJwtAuth,

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const callData = obj.callData as Record<string, unknown> | undefined
    const metaData = callData?.metaData as Record<string, unknown> | undefined
    const id = metaData?.id
    if (typeof id === 'string' && id) {
      return `gong:${id}`
    }
    if (typeof id === 'number') {
      return `gong:${id}`
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const callData = b.callData as Record<string, unknown> | undefined
    const metaData = (callData?.metaData as Record<string, unknown>) || {}
    const content = callData?.content as Record<string, unknown> | undefined
    const callId =
      typeof metaData.id === 'string' || typeof metaData.id === 'number' ? String(metaData.id) : ''

    return {
      input: {
        isTest: b.isTest ?? false,
        callData,
        metaData,
        parties: (callData?.parties as unknown[]) || [],
        context: (callData?.context as unknown[]) || [],
        trackers: (content?.trackers as unknown[]) || [],
        topics: (content?.topics as unknown[]) || [],
        highlights: (content?.highlights as unknown[]) || [],
        eventType: 'gong.automation_rule',
        callId,
      },
    }
  },
}
