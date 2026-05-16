import { createHmac } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { z } from 'zod'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { sleepUntilAborted } from '@/lib/data-drains/destinations/utils'
import type { DeliveryMetadata, DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainWebhookDestination')

/** Initial attempt + 3 retries — 500ms/1s/2s backoff sequence. */
const MAX_ATTEMPTS = 4
const PER_ATTEMPT_TIMEOUT_MS = 30_000
/** Cap responder reply so a misbehaving receiver can't OOM the runner. */
const MAX_RESPONSE_BYTES = 256 * 1024
const SIGNATURE_VERSION = 'v1'
const USER_AGENT = 'Sim-DataDrain/1.0'

/**
 * Headers `buildHeaders` emits. Callers cannot override these via
 * `signatureHeader`. Keep in sync with `buildHeaders` — the drift-guard test
 * enforces this by parsing the schema against every key the function writes.
 */
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

/** CR/LF/NUL would let a bearer token smuggle additional response headers. */
const HEADER_INJECTION_PATTERN = /[\r\n\0]/

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
    .max(2048, 'url must be at most 2048 characters')
    .refine((value) => validateExternalUrl(value, 'url').isValid, {
      message: 'url must be HTTPS and not point at a private, loopback, or metadata address',
    }),
  signatureHeader: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => !RESERVED_SIGNATURE_HEADER_NAMES.has(value.toLowerCase()), {
      message: 'signatureHeader cannot reuse a reserved Sim header name',
    })
    .refine((value) => !HEADER_INJECTION_PATTERN.test(value) && /^[A-Za-z0-9\-_]+$/.test(value), {
      message: 'signatureHeader must contain only letters, digits, hyphens, and underscores',
    })
    .optional(),
})

const webhookCredentialsSchema = z.object({
  signingSecret: z
    .string()
    .min(32, 'signingSecret must be at least 32 characters')
    .max(512, 'signingSecret must be at most 512 characters'),
  bearerToken: z
    .string()
    .min(1)
    .max(4096, 'bearerToken must be at most 4096 characters')
    .refine((value) => !HEADER_INJECTION_PATTERN.test(value), {
      message: 'bearerToken cannot contain CR, LF, or NUL characters',
    })
    .optional(),
})

export type WebhookDestinationConfig = z.infer<typeof webhookConfigSchema>
export type WebhookDestinationCredentials = z.infer<typeof webhookCredentialsSchema>

/**
 * Stripe-style signature: HMAC-SHA256 over `${unixSeconds}.${body}` rendered as
 * `t=<unixSeconds>,v1=<hex>`. Verifiers reject stale timestamps (~5 min skew)
 * to block replay; we re-sign per attempt so long backoffs don't fall outside
 * that window.
 */
function sign(body: Buffer, secret: string, timestamp: number): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')
  return `t=${timestamp},${SIGNATURE_VERSION}=${hmac}`
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
    // Stable across retries of the same chunk so receivers can dedupe.
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
      maxResponseBytes: MAX_RESPONSE_BYTES,
    })
    if (!response.ok) {
      throw new Error(`Webhook probe failed: HTTP ${response.status}`)
    }
  },

  openSession({ config, credentials }) {
    let resolvedIP: string | null = null
    return {
      async deliver({ body, contentType, metadata, signal }) {
        // Resolve once per session and pin across retries to defeat DNS rebinding (TOCTOU).
        if (resolvedIP === null) {
          resolvedIP = await resolvePublicTarget(config.url)
        }
        let lastError: unknown
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (signal.aborted) throw signal.reason ?? new Error('Aborted')
          const headers = buildHeaders({ config, credentials, body, contentType, metadata })
          let retryAfterMs: number | null = null
          let response: Awaited<ReturnType<typeof secureFetchWithPinnedIP>> | undefined
          try {
            response = await secureFetchWithPinnedIP(config.url, resolvedIP, {
              method: 'POST',
              body: new Uint8Array(body),
              headers,
              signal,
              timeout: PER_ATTEMPT_TIMEOUT_MS,
              maxResponseBytes: MAX_RESPONSE_BYTES,
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
