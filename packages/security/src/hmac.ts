import { createHmac } from 'node:crypto'

/**
 * HMAC-SHA256 of a UTF-8 body using the given secret, hex-encoded. Use for
 * webhook signature verification where the provider sends a hex digest
 * (e.g. `X-Signature: <hex>` or `X-Hub-Signature-256: sha256=<hex>`). Pass the
 * secret as a `Buffer` when the provider's scheme requires base64-decoding
 * (e.g. Svix-compatible `whsec_...` secrets). Pair with
 * {@link ../compare | safeCompare} for timing-safe comparison.
 */
export function hmacSha256Hex(body: string, secret: string | Buffer): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

/**
 * HMAC-SHA256 of a UTF-8 body using the given secret, base64-encoded. Use for
 * webhook signature verification where the provider sends a base64 digest
 * (e.g. Typeform, Microsoft Teams outgoing webhooks). Pass the secret as a
 * `Buffer` when the provider's scheme requires base64-decoding. Pair with
 * {@link ../compare | safeCompare} for timing-safe comparison.
 */
export function hmacSha256Base64(body: string, secret: string | Buffer): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64')
}
