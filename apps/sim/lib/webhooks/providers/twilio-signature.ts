import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:TwilioSignature')

/**
 * Validate `X-Twilio-Signature`: HMAC-SHA1 over the callback URL plus each POST
 * param key/value sorted alphabetically.
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, unknown>
): Promise<boolean> {
  try {
    if (!authToken || !signature || !url) {
      logger.warn('Twilio signature validation missing required fields', {
        hasAuthToken: !!authToken,
        hasSignature: !!signature,
        hasUrl: !!url,
      })
      return false
    }
    const sortedKeys = Object.keys(params).sort()
    let data = url
    for (const key of sortedKeys) {
      data += key + params[key]
    }
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const signatureArray = Array.from(new Uint8Array(signatureBytes))
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
    return safeCompare(signatureBase64, signature)
  } catch (error) {
    logger.error('Error validating Twilio signature:', error)
    return false
  }
}

/**
 * Reconstruct the public callback URL Twilio signed, recovering the original
 * host/proto from forwarding headers when Sim runs behind a proxy. Forged headers
 * don't help an attacker: without the auth token they can't match the signature.
 */
function getExternalUrl(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')

  if (host) {
    const url = new URL(request.url)
    return `${proto}://${host}${url.pathname}${url.search}`
  }

  return request.url
}

/**
 * Shared `verifyAuth` for Twilio webhook providers (SMS and Voice). Enforces a
 * valid `X-Twilio-Signature` when an auth token is configured; skips verification
 * when none is set (the provider-wide "optional secret" convention).
 */
export async function verifyTwilioAuth(
  { request, rawBody, requestId, providerConfig }: AuthContext,
  providerLabel: string
): Promise<NextResponse | null> {
  const authToken = providerConfig.authToken as string | undefined

  if (!authToken) {
    logger.warn(
      `[${requestId}] ${providerLabel} webhook has no auth token configured — accepting request without signature verification. Configure an auth token to require signed requests.`
    )
    return null
  }

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) {
    logger.warn(`[${requestId}] ${providerLabel} webhook missing signature header`)
    return new NextResponse('Unauthorized - Missing Twilio signature', { status: 401 })
  }

  let params: Record<string, string> = {}
  try {
    if (typeof rawBody === 'string') {
      const urlParams = new URLSearchParams(rawBody)
      params = Object.fromEntries(urlParams.entries())
    }
  } catch (error) {
    logger.error(
      `[${requestId}] Error parsing ${providerLabel} webhook body for signature validation:`,
      error
    )
    return new NextResponse('Bad Request - Invalid body format', { status: 400 })
  }

  const fullUrl = getExternalUrl(request)
  const isValidSignature = await validateTwilioSignature(authToken, signature, fullUrl, params)

  if (!isValidSignature) {
    logger.warn(`[${requestId}] ${providerLabel} signature verification failed`, {
      url: fullUrl,
      signatureLength: signature.length,
      paramsCount: Object.keys(params).length,
      authTokenLength: authToken.length,
    })
    return new NextResponse('Unauthorized - Invalid Twilio signature', { status: 401 })
  }

  return null
}
