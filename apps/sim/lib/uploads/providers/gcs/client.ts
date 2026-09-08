import type { Readable } from 'node:stream'
import type { Storage } from '@google-cloud/storage'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import {
  assertKnownSizeWithinLimit,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { GCS_CONFIG } from '@/lib/uploads/config'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import type {
  GcsConfig,
  GcsMultipartPart,
  GcsMultipartUploadInit,
  GcsPartUploadUrl,
} from '@/lib/uploads/providers/gcs/types'
import type {
  FileInfo,
  MultipartCompletionPolicy,
  StoredObjectInfo,
} from '@/lib/uploads/shared/types'
import {
  sanitizeFilenameForMetadata,
  sanitizeStorageMetadata,
} from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'

const logger = createLogger('GcsClient')

/** XML API host, also used to build canonical object URLs. */
const GCS_XML_API_HOST = 'https://storage.googleapis.com'
const GCS_MULTIPART_STAGING_PREFIX = '.sim-multipart/'
const GCS_MULTIPART_UPLOAD_ID_METADATA_KEY = 'sim-upload-id'

let _gcsClient: Storage | null = null

/**
 * Reset the cached GCS client. Only intended for use in tests.
 */
export function resetGcsClientForTesting(): void {
  _gcsClient = null
}

interface GcsInlineCredentials {
  client_email: string
  private_key: string
  project_id?: string
}

/**
 * Parse the inline service-account JSON from `GCS_CREDENTIALS_JSON`.
 * Returns null when the variable is unset (Application Default Credentials).
 * @throws Error when the variable is set but not valid service-account JSON
 */
export function parseGcsCredentials(): GcsInlineCredentials | null {
  if (!env.GCS_CREDENTIALS_JSON) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(env.GCS_CREDENTIALS_JSON)
  } catch {
    throw new Error('GCS_CREDENTIALS_JSON is not valid JSON')
  }

  const credentials = parsed as Partial<GcsInlineCredentials>
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GCS_CREDENTIALS_JSON must contain client_email and private_key')
  }

  return credentials as GcsInlineCredentials
}

export async function getGcsClient(): Promise<Storage> {
  if (_gcsClient) return _gcsClient

  const { Storage } = await import('@google-cloud/storage')
  const credentials = parseGcsCredentials()

  _gcsClient = new Storage({
    ...(env.GCS_PROJECT_ID || credentials?.project_id
      ? { projectId: env.GCS_PROJECT_ID || credentials?.project_id }
      : {}),
    ...(credentials
      ? {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        }
      : {}),
  })

  return _gcsClient
}

/**
 * Get an OAuth2 bearer token for authenticated XML API requests
 * (multipart initiate/part/complete/abort have no JSON API equivalent).
 */
async function getGcsAccessToken(): Promise<string> {
  const storage = await getGcsClient()
  const token = await storage.authClient.getAccessToken()
  if (!token) {
    throw new Error(
      'Failed to obtain a Google Cloud access token – check GCS_CREDENTIALS_JSON or Application Default Credentials.'
    )
  }
  return token
}

/** Percent-encode an object key per path segment, preserving `/` separators. */
function encodeObjectKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** Canonical public-style URL for an object (not signed — used as a location reference). */
function buildGcsObjectUrl(bucket: string, key: string): string {
  return `${GCS_XML_API_HOST}/${bucket}/${encodeObjectKey(key)}`
}

interface GcsMultipartStagingIdentity {
  completionId: string
  finalKey: string
}

function getGcsMultipartStagingKey(finalKey: string, completionId: string): string {
  return `${GCS_MULTIPART_STAGING_PREFIX}${completionId}/${finalKey}`
}

function getGcsMultipartStagingIdentity(key: string): GcsMultipartStagingIdentity | null {
  if (!key.startsWith(GCS_MULTIPART_STAGING_PREFIX)) return null
  const remainder = key.slice(GCS_MULTIPART_STAGING_PREFIX.length)
  const separator = remainder.indexOf('/')
  if (separator <= 0 || separator === remainder.length - 1) return null
  return {
    completionId: remainder.slice(0, separator),
    finalKey: remainder.slice(separator + 1),
  }
}

/**
 * Upload a file to Google Cloud Storage
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param configOrSize Custom GCS configuration OR file size in bytes (optional)
 * @param size File size in bytes (required if configOrSize is GcsConfig, optional otherwise)
 * @param preserveKey Preserve the fileName as the storage key without adding timestamp prefix (default: false)
 * @param metadata Optional metadata to store with the file
 * @param createOnly Reject an existing key instead of replacing its object
 * @returns Object with file information
 */
export async function uploadToGcs(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: GcsConfig | number,
  size?: number,
  preserveKey?: boolean,
  metadata?: Record<string, string>,
  createOnly = false
): Promise<FileInfo> {
  let config: GcsConfig
  let fileSize: number
  let shouldPreserveKey: boolean

  if (typeof configOrSize === 'object') {
    config = configOrSize
    fileSize = size ?? file.length
    shouldPreserveKey = preserveKey ?? false
  } else {
    config = { bucket: GCS_CONFIG.bucket }
    fileSize = configOrSize ?? file.length
    shouldPreserveKey = preserveKey ?? false
  }

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = shouldPreserveKey ? fileName : `${Date.now()}-${safeFileName}`

  const storage = await getGcsClient()

  const gcsMetadata: Record<string, string> = {
    originalName: sanitizeFilenameForMetadata(fileName),
    uploadedAt: new Date().toISOString(),
  }

  if (metadata) {
    Object.assign(gcsMetadata, sanitizeStorageMetadata(metadata, 8000))
  }

  await storage
    .bucket(config.bucket)
    .file(uniqueKey)
    .save(file, {
      contentType,
      resumable: false,
      metadata: { metadata: gcsMetadata },
      ...(createOnly ? { preconditionOpts: { ifGenerationMatch: 0 } } : {}),
    })

  const servePath = `/api/files/serve/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

/**
 * Generate a presigned URL for direct file access
 * @param key GCS object key
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600) {
  return getPresignedUrlWithConfig(key, { bucket: GCS_CONFIG.bucket }, expiresIn)
}

/**
 * Generate a presigned URL for direct file access with custom bucket
 * @param key GCS object key
 * @param customConfig Custom GCS configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: GcsConfig,
  expiresIn = 3600
) {
  const storage = await getGcsClient()
  const [url] = await storage
    .bucket(customConfig.bucket)
    .file(key)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    })
  return url
}

/**
 * Generate a presigned URL for direct file upload. `signedHeaders` must be sent
 * verbatim by the uploader — they are covered by the V4 signature.
 */
export async function getGcsPresignedUploadUrl(
  key: string,
  contentType: string,
  metadata: Record<string, string>,
  customConfig: GcsConfig,
  expirationSeconds: number
): Promise<{ url: string; signedHeaders: Record<string, string> }> {
  const storage = await getGcsClient()

  const sanitizedMetadata = sanitizeStorageMetadata(metadata, 8000)
  if (sanitizedMetadata.originalName) {
    sanitizedMetadata.originalName = sanitizeFilenameForMetadata(sanitizedMetadata.originalName)
  }

  const metadataHeaders = Object.entries(sanitizedMetadata).reduce(
    (acc, [k, v]) => {
      acc[`x-goog-meta-${k}`] = encodeURIComponent(v)
      return acc
    },
    {} as Record<string, string>
  )
  const createOnlyHeaders = {
    'x-goog-if-generation-match': '0',
  }

  const [url] = await storage
    .bucket(customConfig.bucket)
    .file(key)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expirationSeconds * 1000,
      contentType,
      extensionHeaders: {
        ...metadataHeaders,
        ...createOnlyHeaders,
      },
    })

  return {
    url,
    signedHeaders: {
      'Content-Type': contentType,
      ...metadataHeaders,
      ...createOnlyHeaders,
    },
  }
}

/**
 * Download a file from Google Cloud Storage
 * @param key GCS object key
 * @returns File buffer
 */
export async function downloadFromGcs(key: string): Promise<Buffer>

/**
 * Download a file from Google Cloud Storage with custom bucket configuration
 * @param key GCS object key
 * @param customConfig Custom GCS configuration
 * @returns File buffer
 */
export async function downloadFromGcs(key: string, customConfig: GcsConfig): Promise<Buffer>

export async function downloadFromGcs(
  key: string,
  customConfig: GcsConfig,
  maxBytes: number
): Promise<Buffer>

export async function downloadFromGcs(
  key: string,
  customConfig: GcsConfig,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined
): Promise<Buffer>

export async function downloadFromGcs(
  key: string,
  customConfig?: GcsConfig,
  maxBytes?: number,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()
  const file = storage.bucket(config.bucket).file(key)

  if (maxBytes !== undefined) {
    const [fileMetadata] = await file.getMetadata()
    signal?.throwIfAborted()
    const knownSize = Number(fileMetadata.size)
    if (Number.isFinite(knownSize)) {
      assertKnownSizeWithinLimit(knownSize, maxBytes, 'storage download')
    }
  }

  return readNodeStreamToBufferWithLimit(file.createReadStream(), {
    maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER,
    label: 'storage download',
    signal,
  })
}

/**
 * Stream an object out of GCS without buffering it. The caller MUST fully consume or
 * `destroy()` the returned stream. Used by the large-CSV import worker so a 1M-row file is
 * never resident in memory.
 */
export async function downloadFromGcsStream(
  key: string,
  customConfig?: GcsConfig
): Promise<Readable> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()
  return storage.bucket(config.bucket).file(key).createReadStream()
}

/**
 * Check whether an object exists in GCS (and return its size when it does).
 * Returns null when the object is missing.
 */
export async function headGcsObject(
  key: string,
  customConfig?: GcsConfig
): Promise<StoredObjectInfo | null> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()

  try {
    const [fileMetadata] = await storage.bucket(config.bucket).file(key).getMetadata()
    return {
      size: Number(fileMetadata.size) || 0,
      contentType: fileMetadata.contentType,
      uploadId: readUploadId(fileMetadata.metadata as Record<string, string> | undefined),
      version: String(fileMetadata.generation ?? ''),
      ...(fileMetadata.metadata
        ? { metadata: fileMetadata.metadata as Record<string, string> }
        : {}),
    }
  } catch (error) {
    const code = (error as { code?: number } | null)?.code
    if (code === 404) {
      return null
    }
    throw error
  }
}

/** Deletes an upload object only if it is still the generation the caller inspected. */
export async function deleteGcsObjectVersion(params: {
  key: string
  generation: string
  customConfig: GcsConfig
}): Promise<void> {
  if (!params.generation) throw new Error('GCS upload object is missing its generation')
  const storage = await getGcsClient()
  await storage
    .bucket(params.customConfig.bucket)
    .file(params.key, { generation: params.generation })
    .delete({ ifGenerationMatch: params.generation })
}

/**
 * Get the custom metadata stored on a GCS object.
 */
export async function getGcsObjectMetadata(
  key: string,
  customConfig?: GcsConfig
): Promise<Record<string, string>> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()
  const [fileMetadata] = await storage.bucket(config.bucket).file(key).getMetadata()
  return (fileMetadata.metadata as Record<string, string> | undefined) || {}
}

async function getGcsMultipartCompletionId(
  key: string,
  customConfig?: GcsConfig
): Promise<string | null> {
  try {
    const metadata = await getGcsObjectMetadata(key, customConfig)
    return metadata[GCS_MULTIPART_UPLOAD_ID_METADATA_KEY] ?? null
  } catch (error) {
    if (isObjectNotFoundError(error)) return null
    throw error
  }
}

function isGcsCreateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; statusCode?: unknown }
  return record.code === 412 || record.statusCode === 412
}

/**
 * Delete a file from Google Cloud Storage
 * @param key GCS object key
 */
export async function deleteFromGcs(key: string): Promise<void>

/**
 * Delete a file from Google Cloud Storage with custom bucket configuration
 * @param key GCS object key
 * @param customConfig Custom GCS configuration
 */
export async function deleteFromGcs(key: string, customConfig: GcsConfig): Promise<void>

export async function deleteFromGcs(key: string, customConfig?: GcsConfig): Promise<void> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()
  await storage.bucket(config.bucket).file(key).delete({ ignoreNotFound: true })
}

/**
 * Normalize an ETag to the quoted form GCS expects in CompleteMultipartUpload.
 * Accept either form so server-uploaded and provider-listed parts share the same
 * completion path.
 */
function normalizeEtag(etag: string): string {
  return etag.startsWith('"') ? etag : `"${etag}"`
}

/** Escape a value for embedding in an XML text node. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Perform an authenticated request against the GCS XML API. Multipart uploads
 * (initiate/part/complete/abort) exist only on the XML API — the JSON API has
 * no equivalent — so these calls go through fetch with a bearer token instead
 * of the SDK.
 */
async function gcsXmlApiRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  bucket: string,
  key: string,
  query: string,
  options?: { headers?: Record<string, string>; body?: Buffer | string }
): Promise<Response> {
  const token = await getGcsAccessToken()
  const url = `${buildGcsObjectUrl(bucket, key)}?${query}`

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
    // Buffer is a valid BodyInit at runtime; undici's types only admit ArrayBufferView
    body: options?.body as BodyInit | undefined,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(
      `GCS XML API ${method} ${query.split('&')[0]} failed for ${key}: ${response.status} ${response.statusText}${errorBody ? ` – ${errorBody.slice(0, 500)}` : ''}`
    )
  }

  return response
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Initiate a multipart upload for GCS (XML API, S3-compatible semantics)
 */
export async function initiateGcsMultipartUpload(
  options: GcsMultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { fileName, contentType, customConfig, customKey, purpose, metadata } = options

  const config = customConfig || { bucket: GCS_CONFIG.bucket }

  const safeFileName = sanitizeFileName(fileName)
  const finalKey = customKey || `kb/${generateId()}-${safeFileName}`
  const completionId = generateId()
  const uniqueKey = metadata?.uploadId
    ? finalKey
    : getGcsMultipartStagingKey(finalKey, completionId)

  const response = await gcsXmlApiRequest('POST', config.bucket, uniqueKey, 'uploads', {
    headers: {
      'Content-Type': contentType,
      'x-goog-meta-originalname': encodeURIComponent(sanitizeFilenameForMetadata(fileName)),
      'x-goog-meta-uploadedat': new Date().toISOString(),
      'x-goog-meta-purpose': purpose || 'knowledge-base',
      ...Object.fromEntries(
        Object.entries(sanitizeStorageMetadata(metadata ?? {}, 8000)).map(([key, value]) => [
          `x-goog-meta-${key.toLowerCase()}`,
          value,
        ])
      ),
      [`x-goog-meta-${GCS_MULTIPART_UPLOAD_ID_METADATA_KEY}`]: completionId,
    },
  })

  const xml = await response.text()
  const uploadIdMatch = xml.match(/<UploadId>([^<]+)<\/UploadId>/)
  if (!uploadIdMatch) {
    throw new Error('Failed to initiate GCS multipart upload: no UploadId in response')
  }

  return {
    uploadId: uploadIdMatch[1],
    key: uniqueKey,
  }
}

/**
 * Upload a single multipart part from the server (Body in hand), returning its
 * `{ PartNumber, ETag }`. The presigned variant ({@link getGcsMultipartPartUrls})
 * is for browser uploads; this is the server-side streaming path.
 */
export async function uploadGcsPart(
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
  customConfig?: GcsConfig
): Promise<GcsMultipartPart> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const response = await gcsXmlApiRequest(
    'PUT',
    config.bucket,
    key,
    `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`,
    { body }
  )

  const etag = response.headers.get('etag')
  if (!etag) {
    throw new Error(`GCS part upload returned no ETag for part ${partNumber} of ${key}`)
  }
  return { PartNumber: partNumber, ETag: etag }
}

/**
 * Generate presigned URLs for uploading parts to GCS. The URLs sign the
 * `partNumber`/`uploadId` query parameters (V4), matching the S3 flow.
 *
 * `expires` is required rather than defaulted: the caller owns the part-URL lifetime and
 * advertises the matching `expiresAt` to the client, so a local default would be a second
 * source of truth that silently keeps signing 1h URLs after the caller's window changed.
 */
export async function getGcsMultipartPartUrls(
  key: string,
  uploadId: string,
  partNumbers: number[],
  customConfig: GcsConfig | undefined,
  /** Absolute instant the signature stops being valid. */
  expires: Date
): Promise<GcsPartUploadUrl[]> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const storage = await getGcsClient()
  const file = storage.bucket(config.bucket).file(key)

  return Promise.all(
    partNumbers.map(async (partNumber) => {
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        queryParams: {
          partNumber: String(partNumber),
          uploadId,
        },
      })
      return { partNumber, url }
    })
  )
}

/** Lists the provider-authoritative state for an XML API multipart upload. */
export async function listGcsMultipartParts(
  key: string,
  uploadId: string,
  customConfig?: GcsConfig
): Promise<Array<{ partNumber: number; etag: string; size: number }>> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const parts: Array<{ partNumber: number; etag: string; size: number }> = []
  let marker: number | undefined

  for (;;) {
    const query = `uploadId=${encodeURIComponent(uploadId)}${marker === undefined ? '' : `&part-number-marker=${marker}`}`
    const response = await gcsXmlApiRequest('GET', config.bucket, key, query)
    const xml = await response.text()
    for (const match of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
      const partXml = match[1]
      const numberMatch = partXml.match(/<PartNumber>(\d+)<\/PartNumber>/)
      const etagMatch = partXml.match(/<ETag>([\s\S]*?)<\/ETag>/)
      const sizeMatch = partXml.match(/<Size>(\d+)<\/Size>/)
      if (!numberMatch || !etagMatch || !sizeMatch) {
        throw new Error(`GCS returned incomplete part metadata for ${key}`)
      }
      parts.push({
        partNumber: Number(numberMatch[1]),
        etag: decodeXml(etagMatch[1]),
        size: Number(sizeMatch[1]),
      })
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
    const nextMarker = xml.match(/<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/)
    if (!nextMarker) {
      throw new Error(`GCS truncated the part listing for ${key} without a continuation marker`)
    }
    marker = Number(nextMarker[1])
  }

  return parts
}

/**
 * Complete multipart upload for GCS
 */
export async function completeGcsMultipartUpload(
  key: string,
  uploadId: string,
  parts: GcsMultipartPart[],
  customConfig?: GcsConfig,
  completionPolicy: MultipartCompletionPolicy = 'create-only'
): Promise<{ location: string; path: string; key: string }> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  const stagingIdentity = getGcsMultipartStagingIdentity(key)

  const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)
  const partsXml = sortedParts
    .map(
      (part) =>
        `<Part><PartNumber>${part.PartNumber}</PartNumber><ETag>${escapeXml(normalizeEtag(part.ETag))}</ETag></Part>`
    )
    .join('')
  const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`

  let responseXml: string | undefined
  try {
    const response = await gcsXmlApiRequest(
      'POST',
      config.bucket,
      key,
      `uploadId=${encodeURIComponent(uploadId)}`,
      {
        headers: { 'Content-Type': 'application/xml' },
        body,
      }
    )
    responseXml = await response.text()
  } catch (error) {
    if (!stagingIdentity) {
      throw error
    }
    if (
      (await getGcsMultipartCompletionId(stagingIdentity.finalKey, config)) ===
      stagingIdentity.completionId
    ) {
      return {
        location: buildGcsObjectUrl(config.bucket, stagingIdentity.finalKey),
        path: `/api/files/serve/${encodeURIComponent(stagingIdentity.finalKey)}`,
        key: stagingIdentity.finalKey,
      }
    }
    if ((await getGcsMultipartCompletionId(key, config)) !== stagingIdentity.completionId) {
      throw error
    }
  }

  // The S3 XML dialect permits a 200 response carrying an error document; GCS
  // does not document that behavior, but checking is cheap insurance against
  // reporting a failed completion as success.
  if (responseXml?.includes('<Error')) {
    throw new Error(`GCS multipart completion failed for ${key}: ${responseXml.slice(0, 500)}`)
  }

  if (stagingIdentity) {
    if ((await getGcsMultipartCompletionId(key, config)) !== stagingIdentity.completionId) {
      throw new Error(`GCS multipart staging receipt does not match upload ${key}`)
    }
    const storage = await getGcsClient()
    const bucket = storage.bucket(config.bucket)
    const stagingFile = bucket.file(key)
    const destinationFile = bucket.file(stagingIdentity.finalKey)
    try {
      await stagingFile.copy(
        destinationFile,
        completionPolicy === 'replace' ? {} : { preconditionOpts: { ifGenerationMatch: 0 } }
      )
    } catch (error) {
      const finalCompletionId = await getGcsMultipartCompletionId(stagingIdentity.finalKey, config)
      const isSameUpload = finalCompletionId === stagingIdentity.completionId
      const canReuseExisting =
        completionPolicy === 'reuse-existing' &&
        isGcsCreateConflict(error) &&
        finalCompletionId !== null
      if (!isSameUpload && !canReuseExisting) {
        throw error
      }
    }
    try {
      await stagingFile.delete({ ignoreNotFound: true })
    } catch (error) {
      logger.warn(`Failed to clean up finalized GCS multipart staging object ${key}`, error)
    }
    return {
      location: buildGcsObjectUrl(config.bucket, stagingIdentity.finalKey),
      path: `/api/files/serve/${encodeURIComponent(stagingIdentity.finalKey)}`,
      key: stagingIdentity.finalKey,
    }
  }

  return {
    location: buildGcsObjectUrl(config.bucket, key),
    path: `/api/files/serve/${encodeURIComponent(key)}`,
    key,
  }
}

/**
 * Abort multipart upload for GCS
 */
export async function abortGcsMultipartUpload(
  key: string,
  uploadId: string,
  customConfig?: GcsConfig
): Promise<void> {
  const config = customConfig || { bucket: GCS_CONFIG.bucket }
  await gcsXmlApiRequest('DELETE', config.bucket, key, `uploadId=${encodeURIComponent(uploadId)}`)
}

function readUploadId(metadata?: Record<string, string>): string | undefined {
  if (!metadata) return undefined
  return Object.entries(metadata).find(([key]) => key.toLowerCase() === 'uploadid')?.[1]
}
