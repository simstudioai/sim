import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_TIMEOUT_MS = 5_000

const logger = createLogger('TurnstileVerify')

interface TurnstileSiteverifyResponse {
  success: boolean
  'error-codes'?: string[]
  challenge_ts?: string
  hostname?: string
  action?: string
  cdata?: string
  metadata?: { interactive?: boolean }
}

export interface VerifyTurnstileResult {
  success: boolean
  errorCodes?: string[]
  /** True when the siteverify request itself failed (network/timeout). */
  transportError?: boolean
}

export interface VerifyTurnstileOptions {
  token: string | null | undefined
  remoteIp?: string
  /** Rejects the token when Cloudflare's reported hostname differs. */
  expectedHostname?: string
  idempotencyKey?: string
}

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint. Tokens
 * are single-use and expire after 300 seconds; never cache the result.
 */
export async function verifyTurnstileToken({
  token,
  remoteIp,
  expectedHostname,
  idempotencyKey,
}: VerifyTurnstileOptions): Promise<VerifyTurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY
  if (!secret) {
    logger.warn('Turnstile verification called without TURNSTILE_SECRET_KEY configured')
    return { success: false, errorCodes: ['missing-input-secret'] }
  }

  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] }
  }

  const body = new URLSearchParams()
  body.set('secret', secret)
  body.set('response', token)
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp)
  if (idempotencyKey) body.set('idempotency_key', idempotencyKey)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS)

  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.warn('Turnstile siteverify returned non-2xx', { status: response.status })
      return { success: false, transportError: true }
    }

    const data = (await response.json()) as TurnstileSiteverifyResponse

    if (!data.success) {
      return { success: false, errorCodes: data['error-codes'] }
    }

    if (expectedHostname && data.hostname && data.hostname !== expectedHostname) {
      logger.warn('Turnstile hostname mismatch', {
        expected: expectedHostname,
        actual: data.hostname,
      })
      return { success: false, errorCodes: ['hostname-mismatch'] }
    }

    return { success: true }
  } catch (err) {
    const error = toError(err)
    logger.warn('Turnstile siteverify request failed', {
      aborted: error.name === 'AbortError',
      error: error.message,
    })
    return { success: false, transportError: true }
  } finally {
    clearTimeout(timeout)
  }
}

export function isTurnstileConfigured(): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY)
}
