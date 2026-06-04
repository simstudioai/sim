import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { S3Icon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate, readBodyWithLimit } from '@/connectors/utils'
import { encodeS3PathComponent, getSignatureKey } from '@/tools/s3/utils'

const logger = createLogger('S3Connector')

/** Maximum object size to sync. Larger objects are skipped during listing. */
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

/** Number of objects requested per ListObjectsV2 page (S3 caps at 1000). */
const LIST_MAX_KEYS = 1000

/**
 * Default set of file extensions considered safely text-extractable. Objects
 * with any other extension (or no extension) are skipped, since their content
 * cannot be reliably decoded to plain text. Users can override this list via
 * the `extensions` config field.
 */
const DEFAULT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'log',
  'rtf',
])

/**
 * A single object entry parsed out of a ListObjectsV2 XML response.
 */
interface S3ObjectEntry {
  key: string
  etag: string
  lastModified: string
  size: number
}

/**
 * A parsed custom S3-compatible endpoint (Cloudflare R2, MinIO, etc.).
 *
 * `host` is the bare hostname, `hostHeader` is the value used both as the wire
 * `Host` header and in the SigV4 canonical headers — it includes the port when
 * a non-default port is configured (e.g. `localhost:9000`). When the endpoint
 * uses the scheme's default port (443 for https, 80 for http) the port is
 * omitted from `hostHeader`, matching what the HTTP client sends on the wire.
 */
interface S3Endpoint {
  scheme: 'http' | 'https'
  host: string
  hostHeader: string
}

/**
 * AWS credentials and target resource resolved from sourceConfig + access token.
 *
 * When `endpoint` is present the connector targets an S3-compatible store using
 * path-style addressing (`{endpoint}/{bucket}/{key}`). When absent it targets
 * AWS S3 using virtual-hosted-style addressing
 * (`{bucket}.s3.{region}.amazonaws.com`), preserving the original behavior.
 */
interface S3Context {
  accessKeyId: string
  secretAccessKey: string
  region: string
  bucket: string
  endpoint?: S3Endpoint
}

/**
 * Parses the comma-separated `extensions` config override into a normalized set
 * (lowercased, no leading dot). Returns the built-in default set when the
 * override is empty or contains no usable entries.
 */
function resolveExtensions(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return DEFAULT_EXTENSIONS
  const exts = raw
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
  return exts.length > 0 ? new Set(exts) : DEFAULT_EXTENSIONS
}

/**
 * Extracts the lowercased file extension from an object key, or '' if none.
 */
function getExtension(key: string): string {
  const lastSegment = key.split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return ''
  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

/**
 * Returns true when the object key ends in one of the allowed text extensions.
 */
function isSupportedKey(key: string, allowedExtensions: Set<string>): boolean {
  return allowedExtensions.has(getExtension(key))
}

/**
 * Returns true when the host is a loopback address for which plain `http://`
 * is tolerated (local MinIO development). Any other host must use `https://` so
 * that credentials are never transmitted over cleartext.
 */
function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '')
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1'
}

/**
 * Parses and validates a custom S3-compatible endpoint string.
 *
 * Accepts a full origin such as `https://accountid.r2.cloudflarestorage.com` or
 * `http://localhost:9000`. Trailing slashes are stripped. Throws when the value
 * is not a valid URL, carries a path/query/fragment beyond `/` (which would
 * corrupt the path-style canonical URI), or uses plain `http://` against a
 * non-loopback host.
 *
 * The returned `hostHeader` includes the port only when it differs from the
 * scheme default, matching the `Host` header the HTTP client emits — this keeps
 * the SigV4 canonical Host byte-identical to the wire Host.
 */
function parseEndpoint(raw: string): S3Endpoint {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Endpoint must be a valid URL, e.g. https://accountid.r2.cloudflarestorage.com')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Endpoint must use http:// or https://')
  }
  const scheme = url.protocol === 'https:' ? 'https' : 'http'

  if (url.username || url.password) {
    throw new Error('Endpoint must not contain credentials')
  }
  if (url.search || url.hash) {
    throw new Error('Endpoint must not contain a query string or fragment')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (path !== '') {
    throw new Error('Endpoint must not contain a path — provide only the host, e.g. https://host')
  }

  const host = url.hostname
  if (!host) throw new Error('Endpoint is missing a host')
  if (scheme === 'http' && !isLoopbackHost(host)) {
    throw new Error(
      'Plain http:// endpoints are only allowed for localhost — use https:// otherwise'
    )
  }

  const defaultPort = scheme === 'https' ? '443' : '80'
  const port = url.port && url.port !== defaultPort ? url.port : ''
  const hostHeader = port ? `${host}:${port}` : host

  return { scheme, host, hostHeader }
}

/**
 * Resolves AWS credentials and the target bucket from the connector's
 * sourceConfig and the encrypted secret (delivered as accessToken). When an
 * `endpoint` is configured it is parsed/validated into an {@link S3Endpoint} so
 * the connector targets an S3-compatible store via path-style addressing.
 */
function resolveContext(accessToken: string, sourceConfig: Record<string, unknown>): S3Context {
  const accessKeyId = ((sourceConfig.accessKeyId as string) ?? '').trim()
  const region = ((sourceConfig.region as string) ?? '').trim()
  const bucket = ((sourceConfig.bucket as string) ?? '').trim()
  const secretAccessKey = (accessToken ?? '').trim()
  const rawEndpoint = ((sourceConfig.endpoint as string) ?? '').trim()

  if (!accessKeyId) throw new Error('Missing AWS Access Key ID')
  if (!secretAccessKey) throw new Error('Missing AWS Secret Access Key')
  if (!region) throw new Error('Missing AWS region')
  if (!bucket) throw new Error('Missing S3 bucket name')

  const endpoint = rawEndpoint ? parseEndpoint(rawEndpoint) : undefined

  return { accessKeyId, secretAccessKey, region, bucket, endpoint }
}

/**
 * Returns the SigV4 canonical Host header for the request. For AWS this is the
 * virtual-hosted-style host; for a custom endpoint it is the endpoint host
 * (with port when non-default).
 */
function resolveHost(ctx: S3Context): string {
  return ctx.endpoint ? ctx.endpoint.hostHeader : `${ctx.bucket}.s3.${ctx.region}.amazonaws.com`
}

/**
 * Returns the request scheme: always `https` for AWS, or the endpoint scheme
 * (which may be `http` for local MinIO) for a custom endpoint.
 */
function resolveScheme(ctx: S3Context): string {
  return ctx.endpoint ? ctx.endpoint.scheme : 'https'
}

/**
 * Builds the canonical URI for an object key.
 *
 * AWS (virtual-hosted-style): `/{key}` — the bucket lives in the host.
 * Custom endpoint (path-style): `/{bucket}/{key}` — the bucket is the first
 * path segment. Both the bucket and key are percent-encoded per AWS UriEncode
 * rules while preserving `/` separators via {@link encodeS3PathComponent}.
 */
function buildObjectPath(ctx: S3Context, key: string): string {
  const encodedKey = encodeS3PathComponent(key)
  return ctx.endpoint ? `/${encodeS3PathComponent(ctx.bucket)}/${encodedKey}` : `/${encodedKey}`
}

/**
 * Builds the canonical URI for a bucket-level (ListObjectsV2) request.
 *
 * AWS (virtual-hosted-style): `/`.
 * Custom endpoint (path-style): `/{bucket}/`.
 */
function buildBucketPath(ctx: S3Context): string {
  return ctx.endpoint ? `/${encodeS3PathComponent(ctx.bucket)}/` : '/'
}

/**
 * Builds the full request URL from the canonical path and an optional canonical
 * query string. The path passed here is the same canonical, percent-encoded
 * string used to compute the SigV4 signature, so the signed URI and the wire
 * URI are byte-identical.
 */
function buildUrl(ctx: S3Context, encodedPath: string, canonicalQueryString: string): string {
  const base = `${resolveScheme(ctx)}://${resolveHost(ctx)}${encodedPath}`
  return canonicalQueryString ? `${base}?${canonicalQueryString}` : base
}

/**
 * Builds SigV4 request headers for an S3 REST call.
 *
 * `canonicalQueryString` must be the already-sorted, percent-encoded query
 * string (empty for GetObject) — the caller builds the request URL from this
 * exact same string so the signed query and the wire query are byte-identical
 * (the classic continuation-token signing mismatch cannot occur here).
 * `encodedPath` is the canonical URI path starting with '/' (virtual-hosted
 * `/{key}` for AWS, path-style `/{bucket}/{key}` for custom endpoints). The
 * canonical Host header is resolved via {@link resolveHost} and includes the
 * port for non-default custom-endpoint ports, exactly matching the wire Host.
 * Reuses {@link getSignatureKey} from the s3 tool utilities.
 *
 * The signed headers embed `x-amz-date` and are reused verbatim across
 * `fetchWithRetry` attempts. S3 allows a 15-minute clock-skew window; the
 * retry helper's worst-case total backoff (~31s default, ~10s in validate) is
 * far inside that window, so a stale timestamp never triggers
 * RequestTimeTooSkewed.
 */
function buildSignedHeaders(
  ctx: S3Context,
  method: 'GET',
  encodedPath: string,
  canonicalQueryString: string
): Record<string, string> {
  const date = new Date()
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)

  const host = resolveHost(ctx)
  const payloadHash = crypto.createHash('sha256').update('').digest('hex')

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = `${method}\n${encodedPath}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const algorithm = 'AWS4-HMAC-SHA256'
  const credentialScope = `${dateStamp}/${ctx.region}/s3/aws4_request`
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex')}`

  const signingKey = getSignatureKey(ctx.secretAccessKey, dateStamp, ctx.region, 's3')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorizationHeader = `${algorithm} Credential=${ctx.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    Host: host,
    'X-Amz-Content-Sha256': payloadHash,
    'X-Amz-Date': amzDate,
    Authorization: authorizationHeader,
  }
}

/**
 * Percent-encodes a query parameter name or value per AWS SigV4 canonical rules
 * (every byte except the unreserved set `A-Za-z0-9-_.~` is encoded).
 * `encodeURIComponent` leaves `!'()*` unencoded, so those are encoded here.
 */
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

/**
 * Builds the canonical (sorted, percent-encoded) query string for a
 * ListObjectsV2 request. Keys are sorted lexicographically after encoding and
 * each name/value pair is encoded individually.
 */
function buildListQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeQueryValue(key)}=${encodeQueryValue(params[key])}`)
    .join('&')
}

/**
 * Decodes XML entities found in S3 response text values. `&amp;` is decoded
 * last so sequences like `&amp;lt;` resolve to `&lt;` rather than `<`.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Normalizes an ETag from either a ListObjectsV2 XML `<ETag>` element or a
 * GetObject response header into a stable bare token used in the content hash.
 *
 * Strips surrounding double quotes and a leading weak-validator prefix (`W/`).
 * AWS S3 always returns strong, quoted ETags (including the multipart `-N`
 * suffix) identically from List and Get, but S3-compatible stores (MinIO, R2)
 * are not contractually bound to that and could emit a weak ETag on one path
 * and a strong one on the other. Normalizing both ends keeps the
 * `s3:{key}:{etag}` hash invariant between the listing stub and the hydrated
 * document so unchanged objects are not re-uploaded every sync.
 */
function normalizeEtag(raw: string): string {
  return raw.replace(/^W\//, '').replace(/"/g, '')
}

/**
 * Decodes a URL-encoded object key returned when `encoding-type=url` is set.
 * Falls back to the raw value if decoding fails (malformed percent sequence).
 */
function decodeObjectKey(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Extracts the text content of the first matching XML tag within a fragment.
 */
function extractTag(fragment: string, tag: string): string | undefined {
  const match = fragment.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match ? decodeXmlEntities(match[1]) : undefined
}

/**
 * Parses a ListObjectsV2 XML response into object entries plus pagination state.
 *
 * The request is always made with `encoding-type=url`, so the per-`Key` values
 * are percent-encoded in the XML (safe for the regex parser even when keys
 * contain XML-hostile bytes such as `&`, `<`, or ASCII control characters).
 * Each `Key` is XML-entity-decoded then URL-decoded back to its true value.
 * `NextContinuationToken` is opaque and is not affected by `encoding-type`, so
 * it is used verbatim.
 */
function parseListResponse(xml: string): {
  objects: S3ObjectEntry[]
  isTruncated: boolean
  nextContinuationToken?: string
} {
  const objects: S3ObjectEntry[] = []

  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1]
    const rawKey = extractTag(block, 'Key')
    if (!rawKey) continue
    const key = decodeObjectKey(rawKey)

    const etag = normalizeEtag(extractTag(block, 'ETag') ?? '')
    const lastModified = extractTag(block, 'LastModified') ?? ''
    const size = Number(extractTag(block, 'Size') ?? '0')

    objects.push({ key, etag, lastModified, size: Number.isNaN(size) ? 0 : size })
  }

  const isTruncated = extractTag(xml, 'IsTruncated') === 'true'
  const nextContinuationToken = extractTag(xml, 'NextContinuationToken')

  return { objects, isTruncated, nextContinuationToken }
}

/**
 * Builds a metadata stub for an S3 object. The content hash combines the key
 * and ETag — S3's ETag changes whenever object content changes, making it an
 * ideal change indicator. Used by both listDocuments and getDocument to
 * guarantee identical hashes.
 */
function objectToStub(ctx: S3Context, entry: S3ObjectEntry): ExternalDocument {
  const title = entry.key.split('/').pop() || entry.key
  const prefix = entry.key.includes('/') ? entry.key.slice(0, entry.key.lastIndexOf('/')) : ''

  return {
    externalId: entry.key,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildUrl(ctx, buildObjectPath(ctx, entry.key), ''),
    contentHash: `s3:${entry.key}:${entry.etag}`,
    metadata: {
      key: entry.key,
      prefix,
      etag: entry.etag,
      lastModified: entry.lastModified,
      fileSize: entry.size,
    },
  }
}

/**
 * Performs a single ListObjectsV2 page request and returns the parsed result.
 */
async function listObjectsPage(
  ctx: S3Context,
  prefix: string,
  continuationToken: string | undefined,
  retryOptions?: Parameters<typeof fetchWithRetry>[2],
  maxKeys: number = LIST_MAX_KEYS
): Promise<{ objects: S3ObjectEntry[]; isTruncated: boolean; nextContinuationToken?: string }> {
  const queryParams: Record<string, string> = {
    'list-type': '2',
    'encoding-type': 'url',
    'max-keys': String(maxKeys),
  }
  if (prefix) queryParams.prefix = prefix
  if (continuationToken) queryParams['continuation-token'] = continuationToken

  const canonicalQueryString = buildListQueryString(queryParams)
  const bucketPath = buildBucketPath(ctx)
  const headers = buildSignedHeaders(ctx, 'GET', bucketPath, canonicalQueryString)

  const url = buildUrl(ctx, bucketPath, canonicalQueryString)

  const response = await fetchWithRetry(url, { method: 'GET', headers }, retryOptions)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`S3 ListObjectsV2 failed: ${response.status} ${errorText}`)
  }

  const xml = await response.text()
  return parseListResponse(xml)
}

export const s3Connector: ConnectorConfig = {
  id: 's3',
  name: 'Amazon S3',
  description:
    'Sync text-based objects from Amazon S3 or any S3-compatible store (Cloudflare R2, MinIO) into your knowledge base',
  version: '1.1.0',
  icon: S3Icon,

  auth: {
    mode: 'apiKey',
    label: 'Secret Access Key',
    placeholder: 'Enter your AWS Secret Access Key',
  },

  configFields: [
    {
      id: 'accessKeyId',
      title: 'Access Key ID',
      type: 'short-input',
      placeholder: 'e.g. AKIAIOSFODNN7EXAMPLE',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'e.g. us-east-1 (use auto for Cloudflare R2)',
      required: true,
      description:
        'AWS region for the bucket. For Cloudflare R2 use "auto"; for MinIO use the region the server is configured with (commonly us-east-1).',
    },
    {
      id: 'bucket',
      title: 'Bucket',
      type: 'short-input',
      placeholder: 'e.g. my-bucket',
      required: true,
    },
    {
      id: 'endpoint',
      title: 'Custom Endpoint',
      type: 'short-input',
      placeholder: 'https://accountid.r2.cloudflarestorage.com (optional — leave empty for AWS S3)',
      required: false,
      description:
        'S3-compatible endpoint for Cloudflare R2, MinIO, etc. Leave empty for AWS S3. Uses path-style addressing. Plain http:// is only allowed for localhost.',
    },
    {
      id: 'prefix',
      title: 'Prefix',
      type: 'short-input',
      placeholder: 'e.g. docs/ (optional)',
      required: false,
      description: 'Only sync objects whose key starts with this prefix',
    },
    {
      id: 'extensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g. txt, md, csv (optional)',
      required: false,
      description:
        'Comma-separated list of file extensions to sync. Leave blank to use the built-in text formats.',
    },
    {
      id: 'maxObjects',
      title: 'Max Objects',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Stop syncing after this many objects',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const ctx = resolveContext(accessToken, sourceConfig)
    const prefix = ((sourceConfig.prefix as string) ?? '').trim()
    const allowedExtensions = resolveExtensions(sourceConfig.extensions)

    const maxObjects = sourceConfig.maxObjects ? Number(sourceConfig.maxObjects) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    if (maxObjects > 0 && previouslyFetched >= maxObjects) {
      return { documents: [], hasMore: false }
    }

    logger.info('Listing S3 objects', { bucket: ctx.bucket, prefix, cursor: cursor ?? 'initial' })

    const { objects, isTruncated, nextContinuationToken } = await listObjectsPage(
      ctx,
      prefix,
      cursor
    )

    let documents = objects
      .filter((entry) => isSupportedKey(entry.key, allowedExtensions))
      .filter((entry) => entry.size > 0 && entry.size <= MAX_FILE_SIZE)
      .map((entry) => objectToStub(ctx, entry))

    let slicedSome = false
    if (maxObjects > 0) {
      const remaining = maxObjects - previouslyFetched
      if (documents.length > remaining) {
        slicedSome = true
        documents = documents.slice(0, remaining)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxObjects > 0 && totalFetched >= maxObjects
    const moreAvailable = slicedSome || (isTruncated && Boolean(nextContinuationToken))
    if (hitLimit && moreAvailable && syncContext) syncContext.listingCapped = true

    return {
      documents,
      nextCursor: hitLimit ? undefined : isTruncated ? nextContinuationToken : undefined,
      hasMore: hitLimit ? false : isTruncated && Boolean(nextContinuationToken),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const ctx = resolveContext(accessToken, sourceConfig)
    const key = externalId

    try {
      const encodedPath = buildObjectPath(ctx, key)
      const headers = buildSignedHeaders(ctx, 'GET', encodedPath, '')
      const url = buildUrl(ctx, encodedPath, '')

      const response = await fetchWithRetry(url, { method: 'GET', headers })

      if (response.status === 404) return null
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`S3 GetObject failed: ${response.status} ${errorText}`)
      }

      const etag = normalizeEtag(response.headers.get('etag') ?? '')
      const lastModified = response.headers.get('last-modified') ?? ''
      const declaredLength = Number(response.headers.get('content-length') ?? '')

      if (declaredLength > MAX_FILE_SIZE) {
        logger.warn('Skipping oversized S3 object', { key, size: declaredLength })
        return null
      }

      const body = await readBodyWithLimit(response, MAX_FILE_SIZE)
      if (body === null) {
        logger.warn('Skipping oversized S3 object (size cap exceeded while streaming)', { key })
        return null
      }
      const content = body.toString('utf-8')
      if (!content.trim()) return null

      const entry: S3ObjectEntry = {
        key,
        etag,
        lastModified,
        size:
          Number.isNaN(declaredLength) || declaredLength <= 0 ? body.byteLength : declaredLength,
      }
      const stub = objectToStub(ctx, entry)
      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      logger.warn('Failed to get S3 object', { key, error: toError(error).message })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    let ctx: S3Context
    try {
      ctx = resolveContext(accessToken, sourceConfig)
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Invalid configuration') }
    }

    const maxObjects = sourceConfig.maxObjects as string | undefined
    if (maxObjects && (Number.isNaN(Number(maxObjects)) || Number(maxObjects) <= 0)) {
      return { valid: false, error: 'Max objects must be a positive number' }
    }

    const prefix = ((sourceConfig.prefix as string) ?? '').trim()

    try {
      await listObjectsPage(ctx, prefix, undefined, VALIDATE_RETRY_OPTIONS, 1)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      const lower = message.toLowerCase()
      if (
        lower.includes('permanentredirect') ||
        lower.includes('authorizationheadermalformed') ||
        lower.includes(' 301 ')
      ) {
        return {
          valid: false,
          error:
            'Wrong region for this bucket. Update the region to match where the bucket lives (or use "auto" for Cloudflare R2).',
        }
      }
      if (lower.includes('403') || lower.includes('accessdenied') || lower.includes('signature')) {
        return {
          valid: false,
          error: 'Access denied. Check the access key, secret key, and bucket permissions.',
        }
      }
      if (lower.includes('404') || lower.includes('nosuchbucket')) {
        return { valid: false, error: 'Bucket not found. Check the bucket name and region.' }
      }
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'prefix', displayName: 'Folder', fieldType: 'text' },
    { id: 'fileSize', displayName: 'Size (bytes)', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.prefix === 'string' && metadata.prefix.length > 0) {
      result.prefix = metadata.prefix
    }

    if (metadata.fileSize != null) {
      const num = Number(metadata.fileSize)
      if (!Number.isNaN(num)) result.fileSize = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
