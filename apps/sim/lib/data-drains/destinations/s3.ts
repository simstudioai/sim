import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainS3Destination')

const s3ConfigSchema = z.object({
  bucket: z.string().min(1, 'bucket is required').max(255),
  region: z.string().min(1, 'region is required').max(64),
  /** Optional prefix; trailing slash is added automatically when assembling keys. */
  prefix: z.string().max(512).optional(),
  /**
   * Optional override for non-AWS S3-compatible providers (MinIO, R2, GCS interop, etc.).
   * SSRF-validated: HTTPS-only, must not resolve syntactically to a private,
   * loopback, or cloud-metadata address. The AWS SDK will issue requests to
   * this host, so we reject internal targets at the schema boundary.
   */
  endpoint: z
    .string()
    .url()
    .refine((value) => validateExternalUrl(value, 'endpoint').isValid, {
      message: 'endpoint must be HTTPS and not point at a private, loopback, or metadata address',
    })
    .optional(),
  /**
   * Force path-style addressing. Set `true` for MinIO / Ceph RGW; defaults
   * to `false` for AWS S3 and Cloudflare R2.
   */
  forcePathStyle: z.boolean().optional(),
})

const s3CredentialsSchema = z.object({
  accessKeyId: z.string().min(1, 'accessKeyId is required'),
  secretAccessKey: z.string().min(1, 'secretAccessKey is required'),
})

export type S3DestinationConfig = z.infer<typeof s3ConfigSchema>
export type S3DestinationCredentials = z.infer<typeof s3CredentialsSchema>

function buildClient(config: S3DestinationConfig, credentials: S3DestinationCredentials): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
  })
}

function normalizePrefix(raw: string | undefined): string {
  if (!raw) return ''
  // S3 keys cannot start with `/` (creates an empty-name segment); also
  // collapse trailing slashes so the joiner produces a single boundary.
  const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed.length === 0 ? '' : `${trimmed}/`
}

function buildKey(
  config: S3DestinationConfig,
  metadata: {
    drainId: string
    runId: string
    source: string
    sequence: number
    runStartedAt: Date
  }
): string {
  // Partition by the run's start time so all chunks from one run share a
  // single date prefix even if delivery crosses a midnight boundary.
  const partition = metadata.runStartedAt
  const yyyy = partition.getUTCFullYear().toString().padStart(4, '0')
  const mm = (partition.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = partition.getUTCDate().toString().padStart(2, '0')
  const seq = metadata.sequence.toString().padStart(5, '0')
  const prefix = normalizePrefix(config.prefix)
  return `${prefix}${metadata.source}/${metadata.drainId}/${yyyy}/${mm}/${dd}/${metadata.runId}-${seq}.ndjson`
}

function isS3ServiceException(error: unknown): error is S3ServiceException {
  return (
    typeof error === 'object' &&
    error !== null &&
    '$metadata' in error &&
    typeof (error as { name?: unknown }).name === 'string'
  )
}

/**
 * Resolves the optional custom endpoint and confirms it does not point at a
 * private, loopback, or cloud-metadata address. The schema-level
 * `validateExternalUrl` only catches IP literals, so a hostname like
 * `evil.example.com` resolving to `169.254.169.254` would slip past it; the
 * AWS SDK then resolves the host itself, bypassing the SSRF guard.
 */
async function assertEndpointIsPublic(endpoint: string | undefined): Promise<void> {
  if (!endpoint) return
  const result = await validateUrlWithDNS(endpoint, 'endpoint')
  if (!result.isValid) {
    throw new Error(result.error ?? 'S3 endpoint failed SSRF validation')
  }
}

/**
 * Surfaces actionable S3 SDK error codes (`AccessDenied`, `NoSuchBucket`,
 * `InvalidAccessKeyId`, `SignatureDoesNotMatch`, ...) and preserves the
 * original error as `cause` so callers can still branch on `code`/`$metadata`.
 */
async function withS3ErrorContext<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isS3ServiceException(error)) {
      const code = error.name
      const status = error.$metadata?.httpStatusCode
      const requestId = error.$metadata?.requestId
      logger.warn('S3 operation failed', { action, code, status, requestId })
      // Preserve the original SDK error as `cause` so callers can still
      // branch on `code` / `$metadata` while getting an actionable message.
      throw new Error(
        `S3 ${action} failed (${code}${status ? ` ${status}` : ''}): ${error.message}`,
        { cause: error }
      )
    }
    throw error
  }
}

export const s3Destination: DrainDestination<S3DestinationConfig, S3DestinationCredentials> = {
  type: 's3',
  displayName: 'Amazon S3',
  configSchema: s3ConfigSchema,
  credentialsSchema: s3CredentialsSchema,

  async test({ config, credentials, signal }) {
    await assertEndpointIsPublic(config.endpoint)
    const client = buildClient(config, credentials)
    // Probe with a real write so read-only creds and write-only IAM policies
    // surface here instead of at the first scheduled run.
    const probeKey = `${normalizePrefix(config.prefix)}.sim-drain-write-probe/${generateShortId(12)}`
    try {
      await withS3ErrorContext('test-put', () =>
        client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: probeKey,
            Body: Buffer.alloc(0),
            ContentType: 'application/octet-stream',
            ServerSideEncryption: 'AES256',
          }),
          { abortSignal: signal }
        )
      )
      // Best-effort cleanup; ignore failures so a missing s3:DeleteObject
      // doesn't fail the test (write was already proven).
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: probeKey }), {
          abortSignal: signal,
        })
      } catch (cleanupError) {
        logger.debug('S3 test write probe cleanup failed (non-fatal)', {
          bucket: config.bucket,
          key: probeKey,
          error: cleanupError,
        })
      }
    } finally {
      client.destroy()
    }
  },

  openSession({ config, credentials }) {
    const client = buildClient(config, credentials)
    // Cache the DNS-aware endpoint check across all chunks in a run so we
    // pay the lookup once. The SDK creates its own connections, so we can't
    // pin the IP — but doing the check before any S3 call still rejects
    // hostnames that resolve to internal targets at the start of the run.
    // Lazy-init avoids an unhandled rejection if the source yields no chunks
    // and `deliver` never runs (e.g., a drain with nothing new to export).
    let endpointCheck: Promise<void> | null = null
    return {
      async deliver({ body, contentType, metadata, signal }) {
        if (endpointCheck === null) endpointCheck = assertEndpointIsPublic(config.endpoint)
        await endpointCheck
        const key = buildKey(config, metadata)
        await withS3ErrorContext('put-object', () =>
          client.send(
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
              ServerSideEncryption: 'AES256',
              Metadata: {
                'sim-drain-id': metadata.drainId,
                'sim-run-id': metadata.runId,
                'sim-source': metadata.source,
                'sim-sequence': metadata.sequence.toString(),
                'sim-row-count': metadata.rowCount.toString(),
              },
            }),
            { abortSignal: signal }
          )
        )
        logger.debug('S3 chunk delivered', { bucket: config.bucket, key, bytes: body.byteLength })
        return { locator: `s3://${config.bucket}/${key}` }
      },
      async close() {
        client.destroy()
      },
    }
  },
}
