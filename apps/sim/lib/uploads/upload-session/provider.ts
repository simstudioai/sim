import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  getStorageConfig,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import {
  LOCAL_MULTIPART_ROOT,
  LOCAL_STAGING_ROOT,
  LOCAL_UPLOAD_METADATA_SUFFIX,
} from '@/lib/uploads/core/storage-key'
import {
  createBlobConfig,
  createGcsConfig,
  createS3Config,
} from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import type { UploadStorageProvider } from '@/lib/uploads/upload-session/types'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

export type { UploadStorageProvider } from '@/lib/uploads/upload-session/types'

/**
 * Bounded lifetime of every signed data-plane URL this module issues.
 *
 * A signed transfer URL is a bearer credential for writing the object's bytes,
 * so it is deliberately decoupled from the upload session's own TTL. The
 * session stays addressable through its control plane (part URLs, status,
 * complete, abort) for as long as it lives; the credential that can write bytes
 * expires an hour after it was signed, which is the lifetime the pre-session
 * presign route used.
 *
 * Multipart parts are re-signed on demand by the per-surface `.../parts`
 * endpoints, so a long-lived multipart session always outlives its part URLs
 * and recovers by asking for new ones. A whole-object PUT has no such endpoint
 * and needs none: it is size-capped by the provider's single-PUT ceiling
 * (`UPLOAD_SESSION_PUT_MAX_BYTES`, or `UPLOAD_SESSION_LOCAL_PUT_MAX_BYTES` for `local`), is
 * issued and used within one client call, and is not resumable — an expired PUT
 * URL and an interrupted PUT have the identical recovery of starting a new
 * session. Nothing durable is written in either case, because the transfer is
 * signed with a create-only precondition.
 */
export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000

export interface CompletedUploadPart {
  partNumber: number
  etag?: string
  size: number
}

export interface UploadPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export interface UploadObjectHead {
  size: number
  contentType: string
  uploadId: string
  version: string
}

interface LocalUploadMetadata {
  uploadId: string
  contentType: string
  metadata: Record<string, string>
}

export class LocalUploadBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalUploadBodyError'
  }
}

export function uploadStorageProvider(): UploadStorageProvider {
  if (USE_BLOB_STORAGE) return 'blob'
  if (USE_S3_STORAGE) return 's3'
  if (USE_GCS_STORAGE) return 'gcs'
  return 'local'
}

export async function initiateMultipartProviderUpload(params: {
  key: string
  fileName: string
  contentType: string
  fileSize: number
  context: StorageContext
  uploadId: string
  metadata: Record<string, string>
}): Promise<{ provider: UploadStorageProvider; providerUploadId: string | null }> {
  const provider = uploadStorageProvider()
  const config = getStorageConfig(params.context)
  const metadata = { ...params.metadata, uploadId: params.uploadId }

  if (provider === 's3') {
    const { initiateS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
    const result = await initiateS3MultipartUpload({
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      customConfig: createS3Config(config),
      customKey: params.key,
      purpose: params.context,
      metadata,
    })
    return { provider, providerUploadId: result.uploadId }
  }
  if (provider === 'blob') {
    const { initiateMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
    const result = await initiateMultipartUpload({
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      customConfig: createBlobConfig(config),
      customKey: params.key,
      metadata,
    })
    return { provider, providerUploadId: result.uploadId }
  }
  if (provider === 'gcs') {
    const { initiateGcsMultipartUpload } = await import(
      '@/lib/uploads/providers/google-cloud-storage/client'
    )
    const result = await initiateGcsMultipartUpload({
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      customConfig: createGcsConfig(config),
      customKey: params.key,
      purpose: params.context,
      metadata,
    })
    return { provider, providerUploadId: result.uploadId }
  }

  await mkdir(localPartsDirectory(params.uploadId), { recursive: true })
  return { provider, providerUploadId: null }
}

/**
 * Signs the whole-object PUT data plane for an upload session.
 *
 * The returned `expiresAt` is the transfer URL's own expiry, which is not the
 * session's: cloud providers get a signature bounded by {@link UPLOAD_URL_TTL_MS},
 * while the local data plane carries no signature at all and its route admits
 * the upload for as long as the session is live.
 */
export async function createPutProviderTransfer(params: {
  provider: UploadStorageProvider
  key: string
  contentType: string
  fileSize: number
  context: StorageContext
  uploadId: string
  uploadToken: string
  localOrigin?: string
  expiresAt: Date
  metadata: Record<string, string>
}): Promise<{
  method: 'put'
  url: string
  headers: Record<string, string>
  expiresAt: string
}> {
  const expiresIn = Math.floor(
    Math.min(params.expiresAt.getTime() - Date.now(), UPLOAD_URL_TTL_MS) / 1000
  )
  if (expiresIn < 1) throw new Error('Cannot sign an expired PUT upload session')

  if (params.provider === 'local') {
    if (!params.localOrigin) throw new Error('localOrigin is required for local PUT uploads')
    const origin = new URL(params.localOrigin)
    const url = new URL(`/api/v2/uploads/${encodeURIComponent(params.uploadId)}`, origin)
    return {
      method: 'put',
      url: url.toString(),
      headers: {
        'Content-Type': params.contentType,
        'upload-token': params.uploadToken,
      },
      expiresAt: params.expiresAt.toISOString(),
    }
  }

  const signedExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  const config = getStorageConfig(params.context)
  const metadata = { ...params.metadata, uploadId: params.uploadId }
  if (params.provider === 's3') {
    const { getS3PresignedUploadUrl } = await import('@/lib/uploads/providers/s3/client')
    const transfer = await getS3PresignedUploadUrl({
      key: params.key,
      contentType: params.contentType,
      fileSize: params.fileSize,
      metadata,
      customConfig: createS3Config(config),
      expiresIn,
    })
    return { method: 'put', ...transfer, expiresAt: signedExpiresAt }
  }
  if (params.provider === 'blob') {
    const { getBlobPresignedUploadUrl } = await import('@/lib/uploads/providers/blob/client')
    const transfer = await getBlobPresignedUploadUrl({
      key: params.key,
      contentType: params.contentType,
      metadata,
      customConfig: createBlobConfig(config),
      expiresIn,
    })
    return { method: 'put', ...transfer, expiresAt: signedExpiresAt }
  }
  const { getGcsPresignedUploadUrl } = await import(
    '@/lib/uploads/providers/google-cloud-storage/client'
  )
  const transfer = await getGcsPresignedUploadUrl(
    params.key,
    params.contentType,
    metadata,
    createGcsConfig(config),
    expiresIn
  )
  return {
    method: 'put',
    url: transfer.url,
    headers: transfer.signedHeaders,
    expiresAt: signedExpiresAt,
  }
}

/**
 * Signs the per-part data plane for a multipart upload session.
 *
 * The signature lifetime and the advertised `expiresAt` are both derived from
 * {@link UPLOAD_URL_TTL_MS} and threaded into each provider in that provider's own unit —
 * seconds for S3, an absolute instant for blob and GCS. Neither side may re-derive it: a
 * provider defaulting the lifetime internally is how an advertised expiry and the real
 * signature drift apart.
 */
export async function getMultipartProviderPartUrls(params: {
  provider: UploadStorageProvider
  providerUploadId: string | null
  key: string
  context: StorageContext
  partNumbers: number[]
  localUrl: (partNumber: number) => string
}): Promise<UploadPartUrl[]> {
  const expiresOn = new Date(Date.now() + UPLOAD_URL_TTL_MS)
  const expiresIn = Math.floor(UPLOAD_URL_TTL_MS / 1000)
  const expiresAt = expiresOn.toISOString()
  if (params.provider === 'local') {
    return params.partNumbers.map((partNumber) => ({
      partNumber,
      url: params.localUrl(partNumber),
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  if (!params.providerUploadId) throw new Error(`Missing ${params.provider} multipart upload id`)
  const config = getStorageConfig(params.context)

  if (params.provider === 's3') {
    const { getS3MultipartPartUrls } = await import('@/lib/uploads/providers/s3/client')
    const urls = await getS3MultipartPartUrls(
      params.key,
      params.providerUploadId,
      params.partNumbers,
      createS3Config(config),
      expiresIn
    )
    return urls.map(({ partNumber, url }) => ({
      partNumber,
      url,
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  if (params.provider === 'blob') {
    const { getMultipartPartUrls } = await import('@/lib/uploads/providers/blob/client')
    const urls = await getMultipartPartUrls(
      params.key,
      params.partNumbers,
      createBlobConfig(config),
      expiresOn
    )
    return urls.map(({ partNumber, url }) => ({
      partNumber,
      url,
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  const { getGcsMultipartPartUrls } = await import(
    '@/lib/uploads/providers/google-cloud-storage/client'
  )
  const urls = await getGcsMultipartPartUrls(
    params.key,
    params.providerUploadId,
    params.partNumbers,
    createGcsConfig(config),
    expiresOn
  )
  return urls.map(({ partNumber, url }) => ({
    partNumber,
    url,
    headers: { 'Content-Type': 'application/octet-stream' },
    expiresAt,
  }))
}

export async function listMultipartProviderParts(params: {
  provider: UploadStorageProvider
  providerUploadId: string | null
  uploadId: string
  key: string
  context: StorageContext
}): Promise<CompletedUploadPart[]> {
  if (params.provider === 'local') return listLocalMultipartParts(params.uploadId)
  if (!params.providerUploadId) throw new Error(`Missing ${params.provider} multipart upload id`)
  const config = getStorageConfig(params.context)
  if (params.provider === 's3') {
    const { listS3MultipartParts } = await import('@/lib/uploads/providers/s3/client')
    return listS3MultipartParts(params.key, params.providerUploadId, createS3Config(config))
  }
  if (params.provider === 'blob') {
    const { listMultipartParts } = await import('@/lib/uploads/providers/blob/client')
    return listMultipartParts(params.key, createBlobConfig(config))
  }
  const { listGcsMultipartParts } = await import(
    '@/lib/uploads/providers/google-cloud-storage/client'
  )
  return listGcsMultipartParts(params.key, params.providerUploadId, createGcsConfig(config))
}

export async function completeMultipartProviderUpload(params: {
  provider: UploadStorageProvider
  providerUploadId: string | null
  uploadId: string
  key: string
  contentType: string
  context: StorageContext
  parts: CompletedUploadPart[]
  metadata: Record<string, string>
}): Promise<void> {
  if (params.provider === 'local') {
    await assembleLocalParts(
      params.uploadId,
      params.key,
      params.parts,
      params.contentType,
      params.metadata
    )
    return
  }
  if (!params.providerUploadId) throw new Error(`Missing ${params.provider} multipart upload id`)
  const config = getStorageConfig(params.context)
  if (params.provider === 's3') {
    const { completeS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
    await completeS3MultipartUpload(
      params.key,
      params.providerUploadId,
      params.parts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: requiredEtag('s3', part),
      })),
      createS3Config(config)
    )
    return
  }
  if (params.provider === 'blob') {
    const { completeMultipartUpload, deriveBlobBlockId } = await import(
      '@/lib/uploads/providers/blob/client'
    )
    await completeMultipartUpload(
      params.key,
      params.uploadId,
      params.parts.map((part) => ({
        partNumber: part.partNumber,
        blockId: deriveBlobBlockId(part.partNumber),
      })),
      createBlobConfig(config),
      params.contentType,
      { ...params.metadata, uploadId: params.uploadId }
    )
    return
  }
  const { completeGcsMultipartUpload } = await import(
    '@/lib/uploads/providers/google-cloud-storage/client'
  )
  await completeGcsMultipartUpload(
    params.key,
    params.providerUploadId,
    params.parts.map((part) => ({
      PartNumber: part.partNumber,
      ETag: requiredEtag('gcs', part),
    })),
    createGcsConfig(config)
  )
}

export async function headProviderObject(params: {
  provider: UploadStorageProvider
  key: string
  context: StorageContext
}): Promise<UploadObjectHead | null> {
  if (params.provider === 'local') return headLocalObject(params.key)
  const config = getStorageConfig(params.context)
  const head =
    params.provider === 's3'
      ? await import('@/lib/uploads/providers/s3/client').then(({ headS3Object }) =>
          headS3Object(params.key, createS3Config(config))
        )
      : params.provider === 'blob'
        ? await import('@/lib/uploads/providers/blob/client').then(({ headBlobObject }) =>
            headBlobObject(params.key, createBlobConfig(config))
          )
        : await import('@/lib/uploads/providers/google-cloud-storage/client').then(
            ({ headGcsObject }) => headGcsObject(params.key, createGcsConfig(config))
          )
  if (!head) return null
  if (!head.contentType || !head.uploadId || !head.version) {
    throw new Error(`Upload object ${params.key} is missing required provider metadata`)
  }
  return {
    size: head.size,
    contentType: head.contentType,
    uploadId: head.uploadId,
    version: head.version,
  }
}

export async function deleteProviderObjectVersion(params: {
  provider: UploadStorageProvider
  key: string
  version: string
  context: StorageContext
}): Promise<void> {
  if (params.provider === 'local') {
    await deleteLocalObjectVersion(params.key, params.version)
    return
  }
  const config = getStorageConfig(params.context)
  if (params.provider === 's3') {
    const { deleteS3ObjectVersion } = await import('@/lib/uploads/providers/s3/client')
    await deleteS3ObjectVersion({
      key: params.key,
      etag: params.version,
      customConfig: createS3Config(config),
    })
    return
  }
  if (params.provider === 'blob') {
    const { deleteBlobObjectVersion } = await import('@/lib/uploads/providers/blob/client')
    await deleteBlobObjectVersion({
      key: params.key,
      etag: params.version,
      customConfig: createBlobConfig(config),
    })
    return
  }
  const { deleteGcsObjectVersion } = await import(
    '@/lib/uploads/providers/google-cloud-storage/client'
  )
  await deleteGcsObjectVersion({
    key: params.key,
    generation: params.version,
    customConfig: createGcsConfig(config),
  })
}

export async function abortProviderUpload(params: {
  provider: UploadStorageProvider
  method: 'put' | 'multipart'
  providerUploadId: string | null
  uploadId: string
  key: string
  context: StorageContext
}): Promise<void> {
  if (params.provider === 'local') {
    await rm(localPartsDirectory(params.uploadId), { recursive: true, force: true })
    return
  }

  const config = getStorageConfig(params.context)
  if (params.method === 'multipart') {
    if (!params.providerUploadId) {
      throw new Error(`Missing ${params.provider} multipart upload id`)
    }
    if (params.provider === 's3') {
      const { abortS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
      await abortS3MultipartUpload(params.key, params.providerUploadId, createS3Config(config))
    } else if (params.provider === 'blob') {
      const { abortMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
      await abortMultipartUpload(params.key, params.uploadId, createBlobConfig(config))
    } else {
      const { abortGcsMultipartUpload } = await import(
        '@/lib/uploads/providers/google-cloud-storage/client'
      )
      await abortGcsMultipartUpload(params.key, params.providerUploadId, createGcsConfig(config))
    }
  }
}

export async function writeLocalPutObject(params: {
  uploadId: string
  key: string
  body: ReadableStream<Uint8Array>
  expectedSize: number
  contentType: string
  metadata: Record<string, string>
}): Promise<void> {
  const { Readable, Transform } = await import('node:stream')
  const destination = localObjectPath(params.key)
  const { object: temporary, metadata: temporaryMetadata } = localStagedPaths(params.uploadId)
  await Promise.all([
    mkdir(dirname(destination), { recursive: true }),
    mkdir(dirname(temporary), { recursive: true }),
  ])
  let bytes = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > params.expectedSize) {
        callback(new LocalUploadBodyError(`Upload exceeds ${params.expectedSize} bytes`))
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(params.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(temporary, { flags: 'wx' })
    )
    if (bytes !== params.expectedSize) {
      throw new LocalUploadBodyError(`Upload has ${bytes} bytes; expected ${params.expectedSize}`)
    }
    await writeLocalMetadata(temporaryMetadata, {
      uploadId: params.uploadId,
      contentType: params.contentType,
      metadata: { ...params.metadata, uploadId: params.uploadId },
    })
    await publishLocalObject(
      temporary,
      temporaryMetadata,
      destination,
      localMetadataPath(params.key)
    )
  } catch (error) {
    await Promise.allSettled([
      rm(temporary, { force: true }),
      rm(temporaryMetadata, { force: true }),
    ])
    if (error instanceof LocalUploadBodyError) throw error
    throw new Error(getErrorMessage(error, 'Failed to store PUT upload'), { cause: error })
  }
}

export async function writeLocalMultipartPart(params: {
  uploadId: string
  partNumber: number
  body: ReadableStream<Uint8Array>
  expectedSize: number
}): Promise<void> {
  const { Readable, Transform } = await import('node:stream')
  const directory = localPartsDirectory(params.uploadId)
  await mkdir(directory, { recursive: true })
  const destination = localPartPath(params.uploadId, params.partNumber)
  const temporary = join(directory, `.${params.partNumber}-${generateId()}.part`)
  let bytes = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > params.expectedSize) {
        callback(
          new LocalUploadBodyError(`Part ${params.partNumber} exceeds ${params.expectedSize} bytes`)
        )
        return
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(params.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(temporary, { flags: 'wx' })
    )
    if (bytes !== params.expectedSize) {
      throw new LocalUploadBodyError(
        `Part ${params.partNumber} has ${bytes} bytes; expected ${params.expectedSize}`
      )
    }
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    if (error instanceof LocalUploadBodyError) throw error
    throw new Error(getErrorMessage(error, `Failed to store part ${params.partNumber}`), {
      cause: error,
    })
  }
}

function localPartsDirectory(uploadId: string): string {
  return join(UPLOAD_DIR_SERVER, LOCAL_MULTIPART_ROOT, uploadId)
}

/**
 * Paths for an object being staged before it is published at its final key.
 *
 * Staged names are derived from the upload id alone, never from the
 * destination. A temporary built as `destination + suffix` inherits the
 * destination's length and then adds to it, so a key that fits `NAME_MAX`
 * exactly still failed with `ENAMETOOLONG`: that is the 500 the upload-session
 * PUT returned for any file name past roughly 125 characters, and the identical
 * failure multipart `complete` returned while assembling one. Deriving the
 * staged name from a fixed-width id removes the arithmetic rather than
 * re-budgeting it — no suffix added here can depend on the caller's file name,
 * so no future suffix can reintroduce the overflow.
 *
 * The staging root sits inside `UPLOAD_DIR_SERVER`, which keeps publication a
 * same-filesystem `link` and lets the cleanup sweep reclaim what a crashed
 * request left behind — artifacts written next to the destination were never
 * swept at all.
 */
function localStagedPaths(uploadId: string): { object: string; metadata: string } {
  const object = join(UPLOAD_DIR_SERVER, LOCAL_STAGING_ROOT, `${uploadId}-${generateId()}.tmp`)
  return { object, metadata: `${object}${LOCAL_UPLOAD_METADATA_SUFFIX}` }
}

function localPartPath(uploadId: string, partNumber: number): string {
  return join(localPartsDirectory(uploadId), `${partNumber}.part`)
}

function localObjectPath(key: string): string {
  return join(UPLOAD_DIR_SERVER, sanitizeFileKey(key))
}

function localMetadataPath(key: string): string {
  return `${localObjectPath(key)}${LOCAL_UPLOAD_METADATA_SUFFIX}`
}

async function assembleLocalParts(
  uploadId: string,
  key: string,
  parts: CompletedUploadPart[],
  contentType: string,
  metadata: Record<string, string>
): Promise<void> {
  const destination = localObjectPath(key)
  const { object: temporary, metadata: temporaryMetadata } = localStagedPaths(uploadId)
  await Promise.all([
    mkdir(dirname(destination), { recursive: true }),
    mkdir(dirname(temporary), { recursive: true }),
  ])
  try {
    for (const part of parts) {
      await pipeline(
        createReadStream(localPartPath(uploadId, part.partNumber)),
        createWriteStream(temporary, { flags: 'a' })
      )
    }
    await writeLocalMetadata(temporaryMetadata, {
      uploadId,
      contentType,
      metadata: { ...metadata, uploadId },
    })
    await publishLocalObject(temporary, temporaryMetadata, destination, localMetadataPath(key))
    await rm(localPartsDirectory(uploadId), { recursive: true, force: true })
  } catch (error) {
    await Promise.allSettled([
      rm(temporary, { force: true }),
      rm(temporaryMetadata, { force: true }),
    ])
    throw error
  }
}

async function listLocalMultipartParts(uploadId: string): Promise<CompletedUploadPart[]> {
  const directory = localPartsDirectory(uploadId)
  let entries: string[]
  try {
    entries = await readdir(directory, { encoding: 'utf8' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const parts: CompletedUploadPart[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const match = entry.match(/^(\d+)\.part$/)
    if (!match) throw new Error(`Invalid local multipart artifact ${entry}`)
    const file = await stat(join(directory, entry))
    if (!file.isFile()) throw new Error(`Local multipart artifact ${entry} is not a file`)
    parts.push({ partNumber: Number(match[1]), size: file.size })
  }
  return parts
}

/**
 * Names a staged artifact at its final path, refusing to overwrite one already
 * there.
 *
 * `link` is what makes that atomic: it either creates the name or fails
 * `EEXIST`, and no reader ever observes a half-written object under the final
 * key. It also requires both paths to sit on one filesystem. Staging beside the
 * destination guaranteed that; a single `.staging` root does not, because a
 * volume mounted under part of the uploads tree puts the two on different
 * devices and `link` answers `EXDEV`.
 *
 * The fallback copies onto the destination's own device first and links from
 * there, so the create-or-fail step still decides the final name and the
 * no-overwrite guarantee survives — a plain copy to the destination would give
 * that up. The copy's own name is derived from a fresh id, never from the
 * destination, so it inherits none of the destination's path-component length.
 */
async function linkLocalArtifact(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  const sameDeviceCopy = join(dirname(destination), `.${generateId()}.publish`)
  try {
    await copyFile(source, sameDeviceCopy)
    await link(sameDeviceCopy, destination)
  } finally {
    await rm(sameDeviceCopy, { force: true })
  }
}

async function publishLocalObject(
  temporary: string,
  temporaryMetadata: string,
  destination: string,
  destinationMetadata: string
): Promise<void> {
  await linkLocalArtifact(temporary, destination)
  try {
    await linkLocalArtifact(temporaryMetadata, destinationMetadata)
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
  await Promise.all([rm(temporary), rm(temporaryMetadata)])
}

async function headLocalObject(key: string): Promise<UploadObjectHead | null> {
  const path = localObjectPath(key)
  let file: Awaited<ReturnType<typeof stat>>
  try {
    file = await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const metadata = await readLocalMetadata(localMetadataPath(key))
  return {
    size: file.size,
    contentType: metadata.contentType,
    uploadId: metadata.uploadId,
    version: localVersion(file),
  }
}

async function deleteLocalObjectVersion(key: string, version: string): Promise<void> {
  const path = localObjectPath(key)
  let current: Awaited<ReturnType<typeof stat>>
  try {
    current = await stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (localVersion(current) !== version) return
  await unlink(path)
  await rm(localMetadataPath(key), { force: true })
  await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error
  })
}

async function writeLocalMetadata(path: string, metadata: LocalUploadMetadata): Promise<void> {
  await writeFile(path, JSON.stringify(metadata), { encoding: 'utf8', flag: 'wx' })
}

async function readLocalMetadata(path: string): Promise<LocalUploadMetadata> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).uploadId !== 'string' ||
    typeof (parsed as Record<string, unknown>).contentType !== 'string' ||
    typeof (parsed as Record<string, unknown>).metadata !== 'object' ||
    (parsed as Record<string, unknown>).metadata === null ||
    Array.isArray((parsed as Record<string, unknown>).metadata)
  ) {
    throw new Error(`Invalid local upload metadata at ${path}`)
  }
  const record = parsed as Record<string, unknown>
  const metadata = record.metadata as Record<string, unknown>
  if (Object.values(metadata).some((value) => typeof value !== 'string')) {
    throw new Error(`Invalid local upload metadata at ${path}`)
  }
  return {
    uploadId: record.uploadId as string,
    contentType: record.contentType as string,
    metadata: metadata as Record<string, string>,
  }
}

function localVersion(file: Awaited<ReturnType<typeof stat>>): string {
  return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`
}

function requiredEtag(provider: 's3' | 'gcs', part: CompletedUploadPart): string {
  if (!part.etag) throw new Error(`Missing etag for ${provider} part ${part.partNumber}`)
  return part.etag
}
