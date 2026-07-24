import { validateCliCallbackUrl } from '@/lib/core/security/input-validation'

export const CLI_AUTH_STATE_MAX_LENGTH = 128

/** BASE64URL(SHA256(verifier)) — 43 chars, no padding. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/

/** `XXXX-XXXX` over an alphabet with no look-alike characters. */
const PAIRING_PATTERN =
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/

export interface CliAuthRequest {
  /** Validated loopback listener the authorization code is handed back to. */
  callback: string
  /** Opaque nonce echoed back to the CLI unchanged. */
  state: string
  /** PKCE challenge; the CLI redeems the code with the matching verifier. */
  challenge: string
  /** Printed by the CLI, rendered for eyeball comparison. Never sent to the API. */
  pairing: string
}

export type CliAuthRequestResolution =
  | { valid: true; request: CliAuthRequest }
  | { valid: false; reason: string }

interface RawCliAuthParams {
  callback: string | null
  state: string | null
  challenge: string | null
  pairing: string | null
}

/**
 * Shared by the server page (which refuses to bounce an invalid request through
 * login) and the client view (which renders the reason).
 */
export function resolveCliAuthRequest({
  callback,
  state,
  challenge,
  pairing,
}: RawCliAuthParams): CliAuthRequestResolution {
  if (!callback || !state || !challenge || !pairing) {
    return { valid: false, reason: 'This link is missing the parameters the Sim CLI sends.' }
  }

  if (!validateCliCallbackUrl(callback)) {
    return {
      valid: false,
      reason:
        'Codes are only ever handed back to a local listener — the callback must be an http://127.0.0.1 or http://localhost address with no query string.',
    }
  }

  if (state.length > CLI_AUTH_STATE_MAX_LENGTH) {
    return {
      valid: false,
      reason: `The state parameter must be ${CLI_AUTH_STATE_MAX_LENGTH} characters or fewer.`,
    }
  }

  if (!CHALLENGE_PATTERN.test(challenge)) {
    return {
      valid: false,
      reason: 'The challenge parameter must be a base64url-encoded SHA-256 digest.',
    }
  }

  if (!PAIRING_PATTERN.test(pairing)) {
    return { valid: false, reason: 'The pairing code is malformed.' }
  }

  return { valid: true, request: { callback, state, challenge, pairing } }
}

/**
 * Only the code and the echoed state cross this leg — the API key is never in a
 * URL, so nothing durable lands in browser history or the listener's log.
 */
export function buildCliHandoffUrl({ callback, state }: CliAuthRequest, code: string): string {
  const url = new URL(callback)
  url.searchParams.set('code', code)
  url.searchParams.set('state', state)
  return url.toString()
}
