import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { JWT } from 'google-auth-library'
import { z } from 'zod'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainGCSDestination')

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const GCS_HOST = 'https://storage.googleapis.com'
const USER_AGENT = 'sim-data-drain/1.0'
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30_000

/**
 * GCS bucket naming rules: 3-63 chars, lowercase letters/digits/hyphens/dots/
 * underscores, must start and end with a letter or digit, no IP-like names,
 * cannot begin with `goog` and cannot contain `google` or close misspellings.
 * https://cloud.google.com/storage/docs/buckets#naming
 */
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/
const IPV4_LIKE_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const GOOGLE_RESERVED_RE = /^goog|google|g00gle/

const gcsConfigSchema = z.object({
  bucket: z
    .string()
    .min(3, 'bucket must be 3-63 characters')
    .max(63)
    .refine((v) => BUCKET_NAME_RE.test(v), {
      message: 'bucket must be lowercase, 3-63 chars, start/end alphanumeric',
    })
    .refine((v) => !IPV4_LIKE_RE.test(v), {
      message: 'bucket must not look like an IP address',
    })
    .refine((v) => !v.includes('..'), { message: 'bucket must not contain consecutive dots' })
    .refine((v) => !GOOGLE_RESERVED_RE.test(v), {
      message: 'bucket name cannot begin with "goog" or contain "google" / close misspellings',
    }),
  /** Optional prefix; trailing slash is added automatically when assembling object names. */
  prefix: z.string().max(512).optional(),
})

/**
 * Service-account JSON key. We accept the full key file as JSON text and parse
 * only the fields we need so callers can paste it verbatim from the GCP console.
 */
const gcsCredentialsSchema = z
  .object({
    serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
  })
  .superRefine((value, ctx) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value.serviceAccountJson)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: 'serviceAccountJson must be valid JSON',
      })
      return
    }
    if (typeof parsed !== 'object' || parsed === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: 'serviceAccountJson must be a JSON object',
      })
      return
    }
    const obj = parsed as Record<string, unknown>
    if (typeof obj.client_email !== 'string' || obj.client_email.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: 'serviceAccountJson is missing client_email',
      })
    }
    if (typeof obj.private_key !== 'string' || obj.private_key.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceAccountJson'],
        message: 'serviceAccountJson is missing private_key',
      })
    }
  })

export type GCSDestinationConfig = z.infer<typeof gcsConfigSchema>
export type GCSDestinationCredentials = z.infer<typeof gcsCredentialsSchema>

interface ParsedServiceAccount {
  clientEmail: string
  privateKey: string
}

function parseServiceAccount(json: string): ParsedServiceAccount {
  const parsed = JSON.parse(json) as { client_email: string; private_key: string }
  return { clientEmail: parsed.client_email, privateKey: parsed.private_key }
}

function normalizePrefix(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed.length === 0 ? '' : `${trimmed}/`
}

function buildObjectName(
  config: GCSDestinationConfig,
  metadata: {
    drainId: string
    runId: string
    source: string
    sequence: number
    runStartedAt: Date
  }
): string {
  const partition = metadata.runStartedAt
  const yyyy = partition.getUTCFullYear().toString().padStart(4, '0')
  const mm = (partition.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = partition.getUTCDate().toString().padStart(2, '0')
  const seq = metadata.sequence.toString().padStart(5, '0')
  const prefix = normalizePrefix(config.prefix)
  return `${prefix}${metadata.source}/${metadata.drainId}/${yyyy}/${mm}/${dd}/${metadata.runId}-${seq}.ndjson`
}

function buildJwt(account: ParsedServiceAccount): JWT {
  return new JWT({ email: account.clientEmail, key: account.privateKey, scopes: [SCOPE] })
}

/**
 * Caches the OAuth2 access token across deliveries within one session.
 * `JWT.getAccessToken()` already handles expiry-based refresh internally.
 */
async function getAccessToken(jwt: JWT): Promise<string> {
  const { token } = await jwt.getAccessToken()
  if (!token) throw new Error('Failed to obtain GCS access token')
  return token
}

interface UploadInput {
  bucket: string
  objectName: string
  body: Buffer
  contentType: string
  metadata: Record<string, string>
  signal: AbortSignal
  jwt: JWT
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(retryAfterMs, BASE_BACKOFF_MS), MAX_BACKOFF_MS)
  }
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
  return exp * (0.8 + Math.random() * 0.4)
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number.parseInt(header, 10)
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(header)
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

interface RetryRequestInput {
  action: string
  bucket: string
  url: string
  method: string
  headers: Record<string, string>
  body?: BodyInit
  signal: AbortSignal
  /** HTTP statuses to treat as success in addition to 2xx. */
  successStatuses?: number[]
}

async function fetchWithRetry(input: RetryRequestInput): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    let response: Response
    try {
      response = await fetch(input.url, {
        method: input.method,
        body: input.body,
        headers: input.headers,
        signal: input.signal,
      })
    } catch (error) {
      lastError = error
      logger.debug('GCS request failed', {
        action: input.action,
        attempt,
        bucket: input.bucket,
        error: toError(error).message,
      })
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw error
    }
    if (response.ok) return
    if (input.successStatuses?.includes(response.status)) return
    if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
      const text = await response.text().catch(() => '')
      logger.warn('GCS operation failed', {
        action: input.action,
        bucket: input.bucket,
        status: response.status,
      })
      throw new Error(
        `GCS ${input.action} failed (HTTP ${response.status}): ${text || response.statusText}`
      )
    }
    lastError = new Error(`GCS ${input.action} responded with HTTP ${response.status}`)
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    await sleep(backoffMs(attempt, retryAfterMs))
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`GCS ${input.action} failed after retries`)
}

async function uploadObject(action: string, input: UploadInput): Promise<void> {
  const token = await getAccessToken(input.jwt)
  const url = `${GCS_HOST}/upload/storage/v1/b/${encodeURIComponent(input.bucket)}/o?uploadType=media&name=${encodeURIComponent(input.objectName)}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': input.contentType,
    'User-Agent': USER_AGENT,
  }
  for (const [key, value] of Object.entries(input.metadata)) {
    headers[`x-goog-meta-${key}`] = value
  }
  await fetchWithRetry({
    action,
    bucket: input.bucket,
    url,
    method: 'POST',
    headers,
    body: new Uint8Array(input.body),
    signal: input.signal,
  })
}

async function deleteObject(input: {
  bucket: string
  objectName: string
  jwt: JWT
  signal: AbortSignal
}): Promise<void> {
  const token = await getAccessToken(input.jwt)
  const url = `${GCS_HOST}/storage/v1/b/${encodeURIComponent(input.bucket)}/o/${encodeURIComponent(input.objectName)}`
  await fetchWithRetry({
    action: 'delete-object',
    bucket: input.bucket,
    url,
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    signal: input.signal,
    successStatuses: [404],
  })
}

export const gcsDestination: DrainDestination<GCSDestinationConfig, GCSDestinationCredentials> = {
  type: 'gcs',
  displayName: 'Google Cloud Storage',
  configSchema: gcsConfigSchema,
  credentialsSchema: gcsCredentialsSchema,

  async test({ config, credentials, signal }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    const probeName = `${normalizePrefix(config.prefix)}.sim-drain-write-probe/${generateShortId(12)}`
    await uploadObject('test-put', {
      bucket: config.bucket,
      objectName: probeName,
      body: Buffer.alloc(0),
      contentType: 'application/octet-stream',
      metadata: {},
      signal,
      jwt,
    })
    try {
      await deleteObject({ bucket: config.bucket, objectName: probeName, jwt, signal })
    } catch (cleanupError) {
      logger.debug('GCS test write probe cleanup failed (non-fatal)', {
        bucket: config.bucket,
        objectName: probeName,
        error: cleanupError,
      })
    }
  },

  openSession({ config, credentials }) {
    const account = parseServiceAccount(credentials.serviceAccountJson)
    const jwt = buildJwt(account)
    return {
      async deliver({ body, contentType, metadata, signal }) {
        const objectName = buildObjectName(config, metadata)
        await uploadObject('put-object', {
          bucket: config.bucket,
          objectName,
          body,
          contentType,
          metadata: {
            'sim-drain-id': metadata.drainId,
            'sim-run-id': metadata.runId,
            'sim-source': metadata.source,
            'sim-sequence': metadata.sequence.toString(),
            'sim-row-count': metadata.rowCount.toString(),
          },
          signal,
          jwt,
        })
        logger.debug('GCS chunk delivered', {
          bucket: config.bucket,
          objectName,
          bytes: body.byteLength,
        })
        return { locator: `gs://${config.bucket}/${objectName}` }
      },
      async close() {},
    }
  },
}
