import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type S3ServiceException,
} from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { z } from 'zod'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import {
  createPinnedConnectionPool,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { buildObjectKey, normalizePrefix } from '@/lib/data-drains/destinations/utils'
import type { DrainDestination } from '@/lib/data-drains/types'

const logger = createLogger('DataDrainS3Destination')

/** https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html */
const S3_BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const S3_IPV4_LIKE_RE = /^(\d{1,3}\.){3}\d{1,3}$/
/** Matches standard and 4-segment ISO partition codes (e.g. `us-iso-east-1`). */
const AWS_REGION_RE = /^[a-z]{2,}(-[a-z]+)+-\d+$/
/** Cap is over key + value bytes only (no `x-amz-meta-` prefix). */
const MAX_S3_METADATA_BYTES = 2 * 1024
const MAX_S3_KEY_BYTES = 1024
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RESPONSE_BYTES = 256 * 1024

type S3RequestHandler = Extract<
  NonNullable<S3ClientConfig['requestHandler']>,
  { updateHttpClientConfig: unknown; httpHandlerConfigs: unknown }
>

const s3BucketSchema = z
  .string()
  .min(3, 'bucket must be 3-63 characters')
  .max(63, 'bucket must be 3-63 characters')
  .refine((v) => S3_BUCKET_NAME_RE.test(v), {
    message:
      'bucket must be lowercase, 3-63 chars, start/end alphanumeric, only letters/digits/./-',
  })
  .refine((v) => !v.includes('..'), { message: 'bucket must not contain consecutive dots' })
  .refine((v) => !v.includes('-.') && !v.includes('.-'), {
    message: 'bucket must not contain a dash adjacent to a dot',
  })
  .refine((v) => !S3_IPV4_LIKE_RE.test(v), { message: 'bucket must not look like an IP address' })
  .refine((v) => !v.startsWith('xn--'), { message: 'bucket must not start with "xn--"' })
  .refine((v) => !v.startsWith('sthree-'), { message: 'bucket must not start with "sthree-"' })
  .refine((v) => !v.startsWith('amzn-s3-demo-'), {
    message: 'bucket must not start with "amzn-s3-demo-" (reserved by AWS)',
  })
  .refine((v) => !v.endsWith('-s3alias') && !v.endsWith('--ol-s3') && !v.endsWith('.mrap'), {
    message: 'bucket must not end with reserved suffix (-s3alias, --ol-s3, .mrap)',
  })
  .refine((v) => !v.endsWith('--x-s3'), {
    message:
      'bucket must not end with "--x-s3" (reserved for S3 Express One Zone directory buckets)',
  })
  .refine((v) => !v.endsWith('--table-s3'), {
    message: 'bucket must not end with "--table-s3" (reserved for S3 Tables)',
  })

const s3RegionSchema = z
  .string()
  .min(1, 'region is required')
  .max(32, 'region is too long')
  .refine((v) => AWS_REGION_RE.test(v), {
    message: 'region must look like an AWS region code, e.g. us-east-1',
  })

const s3ConfigSchema = z.object({
  bucket: s3BucketSchema,
  region: s3RegionSchema,
  /**
   * Optional prefix; trailing slash is added automatically when assembling keys.
   * Bounded by UTF-8 byte length (not code units) so non-ASCII prefixes can't
   * push assembled keys past S3's 1024-byte object key limit.
   */
  prefix: z
    .string()
    .max(512)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 512, {
      message: 'prefix must be at most 512 bytes (UTF-8)',
    })
    .optional(),
  /**
   * Optional override for non-AWS S3-compatible providers (MinIO, R2, GCS interop, etc.).
   * SSRF-validated: HTTPS-only, must not resolve syntactically to a private,
   * loopback, or cloud-metadata address. The AWS SDK will issue requests to
   * this host, so we reject internal targets at the schema boundary.
   */
  endpoint: z
    .string()
    .url()
    .refine((v) => v.startsWith('https://'), { message: 'endpoint must use https://' })
    .refine((value) => validateExternalUrl(value, 'endpoint', 'configuredEndpoint').isValid, {
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

function createRequestHandler(): S3RequestHandler {
  const connections = createPinnedConnectionPool()
  return {
    async handle(
      request: Parameters<S3RequestHandler['handle']>[0],
      options: Parameters<S3RequestHandler['handle']>[1]
    ) {
      if (request.protocol !== 'https:') throw new Error('S3 requests must use HTTPS')
      const callerSignal = options?.abortSignal
      if (callerSignal && !(callerSignal instanceof AbortSignal)) {
        throw new Error('S3 transport requires a native AbortSignal')
      }
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
      signal.throwIfAborted()
      const hostname = request.hostname
      const authority = hostname.includes(':') ? `[${hostname}]` : hostname
      const origin = `https://${authority}${request.port ? `:${request.port}` : ''}`
      const validation = await validateUrlWithDNS(origin, 'S3 endpoint', 'configuredEndpoint', {
        signal,
      })
      if (!validation.isValid) throw new Error(validation.error)
      const body: unknown = request.body
      if (body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) {
        throw new Error('Unsupported S3 request body')
      }
      const encodeQueryComponent = (value: string) =>
        encodeURIComponent(value).replace(
          /[!'()*]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        )
      const query = request.query ?? {}
      const queryParts: string[] = []
      for (const key of Object.keys(query).sort()) {
        const value = query[key]
        const encodedKey = encodeQueryComponent(key)
        if (value === null) queryParts.push(encodedKey)
        else {
          for (const item of Array.isArray(value) ? value : [value]) {
            queryParts.push(`${encodedKey}=${encodeQueryComponent(item)}`)
          }
        }
      }
      const search = queryParts.join('&')
      const requestTarget = `${request.path}${search ? `?${search}` : ''}`
      const response = await secureFetchWithPinnedIP(
        `${origin}${requestTarget}`,
        validation.resolvedIP,
        {
          profile: 'configuredEndpoint',
          requestTarget,
          method: request.method,
          headers: request.headers,
          body,
          signal,
          timeout: REQUEST_TIMEOUT_MS,
          maxResponseBytes: MAX_RESPONSE_BYTES,
          connectionPool: connections,
        }
      )
      return {
        response: {
          statusCode: response.status,
          headers: response.headers.toRecord(),
          body: Buffer.from(await response.arrayBuffer()),
        },
      }
    },
    destroy() {
      connections.destroy()
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() {
      return {}
    },
  }
}

function buildClient(config: S3DestinationConfig, credentials: S3DestinationCredentials): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle ?? false,
    requestHandler: createRequestHandler(),
  })
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
      logger.warn('S3 operation failed', { action, status })
      /** Preserve SDK error as `cause` so callers can still branch on `code` / `$metadata`. */
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
    const client = buildClient(config, credentials)
    /** Real write probe so write-only IAM policies surface here, not at first run. */
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
      /** Best-effort cleanup: write was already proven, so a missing s3:DeleteObject must not fail the test. */
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: probeKey }), {
          abortSignal: signal,
        })
      } catch {
        logger.debug('S3 test write probe cleanup failed (non-fatal)', {
          bucket: config.bucket,
          key: probeKey,
        })
      }
    } finally {
      client.destroy()
    }
  },

  openSession({ config, credentials }) {
    const client = buildClient(config, credentials)
    return {
      async deliver({ body, contentType, metadata, signal }) {
        const key = buildObjectKey(config.prefix, metadata)
        const keyBytes = Buffer.byteLength(key, 'utf8')
        if (keyBytes > MAX_S3_KEY_BYTES) {
          throw new Error(
            `S3 object key is ${keyBytes} bytes, exceeds the ${MAX_S3_KEY_BYTES}-byte limit`
          )
        }
        const userMetadata: Record<string, string> = {
          'sim-drain-id': metadata.drainId,
          'sim-run-id': metadata.runId,
          'sim-source': metadata.source,
          'sim-sequence': metadata.sequence.toString(),
          'sim-row-count': metadata.rowCount.toString(),
        }
        let metadataBytes = 0
        for (const [k, v] of Object.entries(userMetadata)) {
          metadataBytes += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8')
        }
        if (metadataBytes > MAX_S3_METADATA_BYTES) {
          throw new Error(
            `S3 user metadata is ${metadataBytes} bytes, exceeds the ${MAX_S3_METADATA_BYTES}-byte per-object limit`
          )
        }
        await withS3ErrorContext('put-object', () =>
          client.send(
            new PutObjectCommand({
              Bucket: config.bucket,
              Key: key,
              Body: body,
              ContentType: contentType,
              ServerSideEncryption: 'AES256',
              Metadata: userMetadata,
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
