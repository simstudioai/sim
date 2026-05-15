import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { JWT } from 'google-auth-library'
import { z } from 'zod'
import {
  buildObjectKey,
  normalizePrefix,
  type ParsedServiceAccount,
  parseServiceAccount,
  refineServiceAccountJson,
  sleepUntilAborted,
} from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainGCSDestination')

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const GCS_HOST = 'https://storage.googleapis.com'
const USER_AGENT = 'sim-data-drain/1.0'
const MAX_ATTEMPTS = 4
const PER_ATTEMPT_TIMEOUT_MS = 60_000
/** GCS caps total custom metadata at 8 KiB per object (sum of key + value bytes). */
const MAX_CUSTOM_METADATA_BYTES = 8 * 1024
/** GCS object names are at most 1024 bytes when UTF-8 encoded (flat-namespace buckets). */
const MAX_OBJECT_NAME_BYTES = 1024

const GCS_BUCKET_COMPONENT_RE = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/
const IPV4_LIKE_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const GOOGLE_RESERVED_RE = /^(goog|google|g00gle)/i
const GOOGLE_CONTAINS_RE = /(google|g00gle)/i

function validateGcsBucketComponents(v: string): string | null {
  if (v.length < 3 || v.length > 222) return 'bucket must be 3-222 characters'
  const components = v.split('.')
  for (const c of components) {
    if (c.length < 1 || c.length > 63) {
      return 'each dot-separated component must be 1-63 characters'
    }
    if (!GCS_BUCKET_COMPONENT_RE.test(c)) {
      return 'each component must be lowercase, start/end alphanumeric, letters/digits/_/- only'
    }
  }
  return null
}

const gcsConfigSchema = z.object({
  bucket: z
    .string()
    .min(3, 'bucket must be 3-222 characters')
    .max(222, 'bucket must be 3-222 characters')
    .superRefine((v, ctx) => {
      const err = validateGcsBucketComponents(v)
      if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err })
    })
    .refine((v) => !IPV4_LIKE_RE.test(v), {
      message: 'bucket must not look like an IP address',
    })
    .refine((v) => !v.includes('..'), { message: 'bucket must not contain consecutive dots' })
    .refine((v) => !v.includes('-.') && !v.includes('.-'), {
      message: 'bucket must not contain a dash adjacent to a dot',
    })
    .refine((v) => !GOOGLE_RESERVED_RE.test(v) && !GOOGLE_CONTAINS_RE.test(v), {
      message: 'bucket name cannot begin with "goog" or contain "google" / close misspellings',
    }),
  prefix: z
    .string()
    .max(512)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 512, {
      message: 'prefix must be at most 512 bytes (UTF-8)',
    })
    .refine((v) => !v.startsWith('.well-known/acme-challenge/'), {
      message: 'prefix must not start with ".well-known/acme-challenge/" (reserved by GCS)',
    })
    .optional(),
})

const gcsCredentialsSchema = z
  .object({
    serviceAccountJson: z.string().min(1, 'serviceAccountJson is required'),
  })
  .superRefine(refineServiceAccountJson)

export type GCSDestinationConfig = z.infer<typeof gcsConfigSchema>
export type GCSDestinationCredentials = z.infer<typeof gcsCredentialsSchema>

function buildJwt(account: ParsedServiceAccount): JWT {
  return new JWT({ email: account.clientEmail, key: account.privateKey, scopes: [SCOPE] })
}

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

interface RetryRequestInput {
  action: string
  bucket: string
  url: string
  method: string
  /**
   * Built per attempt so the OAuth access token is refreshed if it expired
   * between retries (google-auth-library caches and refreshes on demand).
   */
  buildHeaders: () => Promise<Record<string, string>>
  body?: BodyInit | Buffer
  signal: AbortSignal
  /** HTTP statuses to treat as success in addition to 2xx. */
  successStatuses?: number[]
}

async function fetchWithRetry(input: RetryRequestInput): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (input.signal.aborted) throw input.signal.reason ?? new Error('Aborted')
    const perAttempt = AbortSignal.any([input.signal, AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS)])
    let response: Response
    try {
      const headers = await input.buildHeaders()
      response = await fetch(input.url, {
        method: input.method,
        body: input.body as BodyInit | undefined,
        headers,
        signal: perAttempt,
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
        await sleepUntilAborted(backoffWithJitter(attempt, null), input.signal)
        continue
      }
      throw error
    }
    if (response.ok || input.successStatuses?.includes(response.status)) {
      /** Drain the success body so undici can return the socket to the keep-alive pool. */
      await response.text().catch(() => '')
      return
    }
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
    /** Drain the retryable response body so undici can return the socket to the keep-alive pool. */
    await response.text().catch(() => '')
    await sleepUntilAborted(backoffWithJitter(attempt, retryAfterMs), input.signal)
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`GCS ${input.action} failed after retries`)
}

/** GCS uses HTTP headers (x-goog-meta-*) to carry custom metadata; the spec forbids non-ASCII. */
const ASCII_ONLY_RE = /^[\x20-\x7e]*$/

async function uploadObject(action: string, input: UploadInput): Promise<void> {
  const objectNameBytes = Buffer.byteLength(input.objectName, 'utf8')
  if (objectNameBytes < 1 || objectNameBytes > MAX_OBJECT_NAME_BYTES) {
    throw new Error(
      `GCS object name is ${objectNameBytes} bytes, must be 1-${MAX_OBJECT_NAME_BYTES} bytes (UTF-8)`
    )
  }
  let metadataBytes = 0
  for (const [key, value] of Object.entries(input.metadata)) {
    if (!ASCII_ONLY_RE.test(key) || !ASCII_ONLY_RE.test(value)) {
      throw new Error(`GCS custom metadata key/value must be ASCII printable: ${key}`)
    }
    metadataBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
  }
  if (metadataBytes > MAX_CUSTOM_METADATA_BYTES) {
    throw new Error(
      `GCS custom metadata is ${metadataBytes} bytes, exceeds the ${MAX_CUSTOM_METADATA_BYTES}-byte per-object limit`
    )
  }
  const url = `${GCS_HOST}/upload/storage/v1/b/${encodeURIComponent(input.bucket)}/o?uploadType=media&name=${encodeURIComponent(input.objectName)}`
  await fetchWithRetry({
    action,
    bucket: input.bucket,
    url,
    method: 'POST',
    buildHeaders: async () => {
      const token = await getAccessToken(input.jwt)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Content-Type': input.contentType,
        'User-Agent': USER_AGENT,
      }
      for (const [key, value] of Object.entries(input.metadata)) {
        headers[`x-goog-meta-${key}`] = value
      }
      return headers
    },
    body: input.body,
    signal: input.signal,
  })
}

async function deleteObject(input: {
  bucket: string
  objectName: string
  jwt: JWT
  signal: AbortSignal
}): Promise<void> {
  const url = `${GCS_HOST}/storage/v1/b/${encodeURIComponent(input.bucket)}/o/${encodeURIComponent(input.objectName)}`
  await fetchWithRetry({
    action: 'delete-object',
    bucket: input.bucket,
    url,
    method: 'DELETE',
    buildHeaders: async () => {
      const token = await getAccessToken(input.jwt)
      return {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      }
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
        const objectName = buildObjectKey(config.prefix, metadata)
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
