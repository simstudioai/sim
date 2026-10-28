import { safeCompare } from './compare'
import { hmacSha256Base64 } from './hmac'

const DEFAULT_TOLERANCE_SECONDS = 5 * 60
const SECRET_PREFIX = 'whsec_'
const BASE64_SECRET = /^[A-Za-z0-9+/_-]+={0,2}$/
const UNIX_SECONDS = /^\d+$/

type StandardWebhookFailure =
  | 'missing_headers'
  | 'invalid_secret'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'no_matching_signature'

type StandardWebhookVerification =
  | { valid: true }
  | { valid: false; reason: StandardWebhookFailure }

interface VerifyStandardWebhookOptions {
  /** Signing secret, `whsec_<base64>` or bare base64. */
  secret: string
  /** The exact request body bytes as received, decoded as UTF-8. Never re-serialized JSON. */
  rawBody: string
  headers: Pick<Headers, 'get'>
  /**
   * `webhook` reads `webhook-id` / `webhook-timestamp` / `webhook-signature` (the Standard
   * Webhooks names); `svix` reads the `svix-*` names Svix-hosted senders use. Only the named
   * set is read, so a provider's external header contract stays exactly what it is.
   */
  headerPrefix?: 'webhook' | 'svix'
  /** Allowed clock skew in either direction. Defaults to 300 seconds, as in the Svix SDK. */
  toleranceSeconds?: number
}

function decodeSecret(secret: string): Buffer | null {
  const trimmed = secret.trim()
  const encoded = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed
  if (!BASE64_SECRET.test(encoded)) return null
  const key = Buffer.from(encoded, 'base64')
  // An empty HMAC key is public: anyone could sign with it.
  return key.length > 0 ? key : null
}

/**
 * Verify a Standard Webhooks (Svix-format) delivery: HMAC-SHA256 of
 * `${id}.${timestamp}.${rawBody}` keyed with the base64-decoded secret, matched in constant
 * time against any space-separated `v1,<base64>` entry of the signature header. Entries with
 * another version label are ignored, and a timestamp outside the tolerance window (past or
 * future) is rejected before hashing.
 *
 * Unlike the Svix SDK it rejects a secret that is not base64 or decodes to no bytes, and a
 * timestamp header that is not plain decimal seconds.
 *
 * @see https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
export function verifyStandardWebhook({
  secret,
  rawBody,
  headers,
  headerPrefix = 'webhook',
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: VerifyStandardWebhookOptions): StandardWebhookVerification {
  const id = headers.get(`${headerPrefix}-id`)
  const timestamp = headers.get(`${headerPrefix}-timestamp`)
  const signatureHeader = headers.get(`${headerPrefix}-signature`)
  if (!id || !timestamp || !signatureHeader) {
    return { valid: false, reason: 'missing_headers' }
  }

  if (!UNIX_SECONDS.test(timestamp)) return { valid: false, reason: 'invalid_timestamp' }
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_out_of_tolerance' }
  }

  const key = decodeSecret(secret)
  if (!key) return { valid: false, reason: 'invalid_secret' }

  const expected = hmacSha256Base64(`${id}.${timestamp}.${rawBody}`, key)
  for (const entry of signatureHeader.split(' ')) {
    const parts = entry.split(',')
    if (parts.length === 2 && parts[0] === 'v1' && safeCompare(parts[1], expected)) {
      return { valid: true }
    }
  }
  return { valid: false, reason: 'no_matching_signature' }
}
