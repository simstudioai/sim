import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { z } from 'zod'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainWebhookDestination')

/** Initial attempt + 3 retries — matches the documented 500ms/1s/2s backoff sequence. */
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30_000
const PER_ATTEMPT_TIMEOUT_MS = 30_000
const SIGNATURE_VERSION = 'v1'
const USER_AGENT = 'Sim-DataDrain/1.0'

/** Reserved header names that callers cannot reuse as the signature header. */
const RESERVED_SIGNATURE_HEADER_NAMES = new Set([
  'authorization',
  'content-type',
  'user-agent',
  'idempotency-key',
  'x-sim-timestamp',
  'x-sim-signature-version',
  'x-sim-drain-id',
  'x-sim-run-id',
  'x-sim-source',
  'x-sim-sequence',
  'x-sim-row-count',
  'x-sim-probe',
  'x-sim-signature',
])

/**
 * Resolves the URL's hostname and returns the validated public IP. Uses
 * `ipaddr.js` so all non-`unicast` ranges (RFC1918, loopback, CGNAT, multicast,
 * broadcast, IPv4-mapped IPv6, link-local, cloud metadata) are blocked
 * uniformly. The returned IP is then pinned to the underlying socket via
 * `secureFetchWithPinnedIP` to defeat DNS rebinding (TOCTOU) between the
 * validation lookup and the actual delivery.
 */
async function resolvePublicTarget(url: string): Promise<string> {
  const result = await validateUrlWithDNS(url, 'url')
  if (!result.isValid || !result.resolvedIP) {
    throw new Error(result.error ?? 'Webhook URL failed SSRF validation')
  }
  return result.resolvedIP
}

const webhookConfigSchema = z.object({
  url: z
    .string()
    .url('url must be a valid URL')
    .refine((value) => validateExternalUrl(value, 'url').isValid, {
      message: 'url must be HTTPS and not point at a private, loopback, or metadata address',
    }),
  /** Optional custom header name for the signature (default: X-Sim-Signature). */
  signatureHeader: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => !RESERVED_SIGNATURE_HEADER_NAMES.has(value.toLowerCase()), {
      message: 'signatureHeader cannot reuse a reserved Sim header name',
    })
    .optional(),
})

const webhookCredentialsSchema = z.object({
  /** Shared secret used for HMAC-SHA256 signing of the request body. */
  signingSecret: z.string().min(8, 'signingSecret must be at least 8 characters'),
  /** Optional bearer token sent as Authorization header. */
  bearerToken: z.string().min(1).optional(),
})

export type WebhookDestinationConfig = z.infer<typeof webhookConfigSchema>
export type WebhookDestinationCredentials = z.infer<typeof webhookCredentialsSchema>

/**
 * Stripe-style replay-resistant signature: signs `${unixSeconds}.${body}` and
 * emits `t=<unixSeconds>,v1=<hex(hmac)>`. Verifiers should reject signatures
 * older than ~5 minutes after also recomputing the HMAC over the same
 * concatenation, defending against captured-request replay attacks.
 */
function sign(body: Buffer, secret: string, timestamp: number): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')
  return `t=${timestamp},${SIGNATURE_VERSION}=${hmac}`
}

/**
 * Resolves after `ms` or as soon as `signal` aborts, whichever happens first.
 * The caller checks `signal.aborted` at the top of the next iteration to
 * surface the abort — keeping resolution side-effect-free here.
 */
function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function backoffWithJitter(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    // Floor at 500ms so a misbehaving server returning Retry-After: 0 cannot
    // pin us in a tight retry loop.
    return Math.min(Math.max(retryAfterMs, BASE_BACKOFF_MS), MAX_BACKOFF_MS)
  }
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
  // ±20% jitter avoids thundering-herd alignment across drains.
  return exponential * (0.8 + Math.random() * 0.4)
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number.parseInt(header, 10)
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(header)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    return delta > 0 ? delta : 0
  }
  return undefined
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function buildHeaders(input: {
  config: WebhookDestinationConfig
  credentials: WebhookDestinationCredentials
  body: Buffer
  contentType: string
  metadata?: DeliveryMetadata
  isProbe?: boolean
}): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const headers: Record<string, string> = {
    'Content-Type': input.contentType,
    'User-Agent': USER_AGENT,
    'X-Sim-Timestamp': timestamp.toString(),
    'X-Sim-Signature-Version': SIGNATURE_VERSION,
    [input.config.signatureHeader ?? 'X-Sim-Signature']: sign(
      input.body,
      input.credentials.signingSecret,
      timestamp
    ),
  }
  if (input.metadata) {
    headers['X-Sim-Drain-Id'] = input.metadata.drainId
    headers['X-Sim-Run-Id'] = input.metadata.runId
    headers['X-Sim-Source'] = input.metadata.source
    headers['X-Sim-Sequence'] = input.metadata.sequence.toString()
    headers['X-Sim-Row-Count'] = input.metadata.rowCount.toString()
    // Lets idempotent receivers dedupe retried chunks server-side.
    headers['Idempotency-Key'] = `${input.metadata.runId}-${input.metadata.sequence}`
  }
  if (input.isProbe) {
    headers['X-Sim-Probe'] = '1'
  }
  if (input.credentials.bearerToken) {
    headers.Authorization = `Bearer ${input.credentials.bearerToken}`
  }
  return headers
}

export const webhookDestination: DrainDestination<
  WebhookDestinationConfig,
  WebhookDestinationCredentials
> = {
  type: 'webhook',
  displayName: 'HTTPS Webhook',
  configSchema: webhookConfigSchema,
  credentialsSchema: webhookCredentialsSchema,

  async test({ config, credentials, signal }) {
    const resolvedIP = await resolvePublicTarget(config.url)
    const probe = Buffer.from('{"sim":"connection-test"}\n', 'utf8')
    const headers = buildHeaders({
      config,
      credentials,
      body: probe,
      contentType: 'application/x-ndjson',
      isProbe: true,
    })
    const response = await secureFetchWithPinnedIP(config.url, resolvedIP, {
      method: 'POST',
      body: new Uint8Array(probe),
      headers,
      signal,
      timeout: PER_ATTEMPT_TIMEOUT_MS,
    })
    if (!response.ok) {
      throw new Error(`Webhook probe failed: HTTP ${response.status}`)
    }
  },

  openSession({ config, credentials }) {
    let resolvedIP: string | null = null
    return {
      async deliver({ body, contentType, metadata, signal }) {
        // Resolve once per session — within a run we trust the result rather
        // than paying DNS on every chunk. Done lazily so a session that's
        // opened-and-immediately-closed pays no cost. The pinned IP is reused
        // across retries to defeat DNS rebinding (TOCTOU) attacks.
        if (resolvedIP === null) {
          resolvedIP = await resolvePublicTarget(config.url)
        }
        let lastError: unknown
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (signal.aborted) throw signal.reason ?? new Error('Aborted')
          // Re-build headers per attempt so the timestamp + signature are
          // fresh (otherwise long backoffs would push us outside the
          // verifier's skew window).
          const headers = buildHeaders({ config, credentials, body, contentType, metadata })
          let retryAfterMs: number | undefined
          let response: Awaited<ReturnType<typeof secureFetchWithPinnedIP>> | undefined
          try {
            response = await secureFetchWithPinnedIP(config.url, resolvedIP, {
              method: 'POST',
              body: new Uint8Array(body),
              headers,
              signal,
              timeout: PER_ATTEMPT_TIMEOUT_MS,
            })
          } catch (error) {
            lastError = error
            logger.debug('Webhook delivery attempt failed', {
              url: config.url,
              attempt,
              error: toError(error).message,
            })
          }
          if (response) {
            if (response.ok) {
              const requestId =
                response.headers.get('x-request-id') ??
                response.headers.get('x-amzn-trace-id') ??
                null
              logger.debug('Webhook chunk delivered', {
                url: config.url,
                attempt,
                status: response.status,
                bytes: body.byteLength,
              })
              return {
                locator: requestId
                  ? `${config.url}#${metadata.runId}-${metadata.sequence}@${requestId}`
                  : `${config.url}#${metadata.runId}-${metadata.sequence}`,
              }
            }
            if (!isRetryableStatus(response.status)) {
              // Non-retryable HTTP error: surface immediately without retrying.
              throw new Error(`Webhook responded with HTTP ${response.status}`)
            }
            lastError = new Error(`Webhook responded with HTTP ${response.status}`)
            retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
          }
          if (attempt < MAX_ATTEMPTS) {
            await sleepUntilAborted(backoffWithJitter(attempt, retryAfterMs), signal)
          }
        }
        throw lastError instanceof Error
          ? lastError
          : new Error('Webhook delivery failed after retries')
      },
      async close() {},
    }
  },
}
