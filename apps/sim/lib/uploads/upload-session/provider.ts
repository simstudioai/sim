import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
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
  createBlobConfig,
  createGcsConfig,
  createS3Config,
  LOCAL_UPLOAD_METADATA_SUFFIX,
} from '@/lib/uploads/core/storage-service'
import type { UploadStorageProvider } from '@/lib/uploads/core/upload-token'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

export type { UploadStorageProvider } from '@/lib/uploads/core/upload-token'

export interface CompletedUploadPart {
  partNumber: number
  etag?: string
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
  stagingKey: string
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
      customKey: params.stagingKey,
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
      customKey: params.stagingKey,
      metadata,
    })
    return { provider, providerUploadId: result.uploadId }
  }
  if (provider === 'gcs') {
    const { initiateGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
    const result = await initiateGcsMultipartUpload({
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize: params.fileSize,
      customConfig: createGcsConfig(config),
      customKey: params.stagingKey,
      purpose: params.context,
      metadata,
    })
    return { provider, providerUploadId: result.uploadId }
  }

  await mkdir(localPartsDirectory(params.uploadId), { recursive: true })
  return { provider, providerUploadId: null }
}

export async function createPutProviderTransfer(params: {
  provider: UploadStorageProvider
  stagingKey: string
  contentType: string
  fileSize: number
  context: StorageContext
  uploadId: string
  uploadToken: string
  localOrigin?: string
  expiresAt: Date
  metadata: Record<string, string>
}): Promise<{ method: 'put'; url: string; headers: Record<string, string> }> {
  const expiresIn = Math.floor((params.expiresAt.getTime() - Date.now()) / 1000)
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
    }
  }

  const config = getStorageConfig(params.context)
  const metadata = { ...params.metadata, uploadId: params.uploadId }
  if (params.provider === 's3') {
    const { getS3PresignedUploadUrl } = await import('@/lib/uploads/providers/s3/client')
    const transfer = await getS3PresignedUploadUrl({
      key: params.stagingKey,
      contentType: params.contentType,
      fileSize: params.fileSize,
      metadata,
      customConfig: createS3Config(config),
      expiresIn,
    })
    return { method: 'put', ...transfer }
  }
  if (params.provider === 'blob') {
    const { getBlobPresignedUploadUrl } = await import('@/lib/uploads/providers/blob/client')
    const transfer = await getBlobPresignedUploadUrl({
      key: params.stagingKey,
      contentType: params.contentType,
      metadata,
      customConfig: createBlobConfig(config),
      expiresIn,
    })
    return { method: 'put', ...transfer }
  }
  const { getGcsPresignedUploadUrl } = await import('@/lib/uploads/providers/gcs/client')
  const transfer = await getGcsPresignedUploadUrl(
    params.stagingKey,
    params.contentType,
    metadata,
    createGcsConfig(config),
    expiresIn
  )
  return { method: 'put', url: transfer.url, headers: transfer.signedHeaders }
}

export async function getMultipartProviderPartUrls(params: {
  provider: UploadStorageProvider
  providerUploadId: string | null
  stagingKey: string
  context: StorageContext
  partNumbers: number[]
  localUrl: (partNumber: number) => string
}): Promise<UploadPartUrl[]> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
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
      params.stagingKey,
      params.providerUploadId,
      params.partNumbers,
      createS3Config(config)
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
      params.stagingKey,
      params.partNumbers,
      createBlobConfig(config)
    )
    return urls.map(({ partNumber, url }) => ({
      partNumber,
      url,
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  const { getGcsMultipartPartUrls } = await import('@/lib/uploads/providers/gcs/client')
  const urls = await getGcsMultipartPartUrls(
    params.stagingKey,
    params.providerUploadId,
    params.partNumbers,
    createGcsConfig(config)
  )
  return urls.map(({ partNumber, url }) => ({
    partNumber,
    url,
    headers: { 'Content-Type': 'application/octet-stream' },
    expiresAt,
  }))
}

export async function completeMultipartProviderUpload(params: {
  provider: UploadStorageProvider
  providerUploadId: string | null
  uploadId: string
  stagingKey: string
  contentType: string
  context: StorageContext
  parts: CompletedUploadPart[]
  metadata: Record<string, string>
}): Promise<void> {
  if (params.provider === 'local') {
    await assembleLocalParts(
      params.uploadId,
      params.stagingKey,
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
      params.stagingKey,
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
      params.stagingKey,
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
  const { completeGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
  await completeGcsMultipartUpload(
    params.stagingKey,
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
        : await import('@/lib/uploads/providers/gcs/client').then(({ headGcsObject }) =>
            headGcsObject(params.key, createGcsConfig(config))
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

export async function promoteProviderObject(params: {
  provider: UploadStorageProvider
  sourceKey: string
  destinationKey: string
  sourceVersion: string
  context: StorageContext
}): Promise<void> {
  if (params.provider === 'local') {
    await promoteLocalObject(params.sourceKey, params.destinationKey, params.sourceVersion)
    return
  }
  const config = getStorageConfig(params.context)
  if (params.provider === 's3') {
    const { promoteS3Object } = await import('@/lib/uploads/providers/s3/client')
    await promoteS3Object({
      sourceKey: params.sourceKey,
      destinationKey: params.destinationKey,
      sourceEtag: params.sourceVersion,
      customConfig: createS3Config(config),
    })
    return
  }
  if (params.provider === 'blob') {
    const { promoteBlobObject } = await import('@/lib/uploads/providers/blob/client')
    await promoteBlobObject({
      sourceKey: params.sourceKey,
      destinationKey: params.destinationKey,
      sourceEtag: params.sourceVersion,
      customConfig: createBlobConfig(config),
    })
    return
  }
  const { promoteGcsObject } = await import('@/lib/uploads/providers/gcs/client')
  await promoteGcsObject({
    sourceKey: params.sourceKey,
    destinationKey: params.destinationKey,
    sourceGeneration: params.sourceVersion,
    customConfig: createGcsConfig(config),
  })
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
  const { deleteGcsObjectVersion } = await import('@/lib/uploads/providers/gcs/client')
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
  stagingKey: string
  context: StorageContext
}): Promise<void> {
  if (params.provider === 'local') {
    await rm(localPartsDirectory(params.uploadId), { recursive: true, force: true })
    await rm(localUploadDirectory(params.uploadId), { recursive: true, force: true })
    return
  }

  const config = getStorageConfig(params.context)
  if (params.method === 'multipart') {
    if (!params.providerUploadId) {
      throw new Error(`Missing ${params.provider} multipart upload id`)
    }
    if (params.provider === 's3') {
      const { abortS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
      await abortS3MultipartUpload(
        params.stagingKey,
        params.providerUploadId,
        createS3Config(config)
      )
    } else if (params.provider === 'blob') {
      const { abortMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
      await abortMultipartUpload(params.stagingKey, createBlobConfig(config))
    } else {
      const { abortGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
      await abortGcsMultipartUpload(
        params.stagingKey,
        params.providerUploadId,
        createGcsConfig(config)
      )
    }
  }

  if (params.provider === 's3') {
    const { deleteFromS3 } = await import('@/lib/uploads/providers/s3/client')
    await deleteFromS3(params.stagingKey, createS3Config(config))
  } else if (params.provider === 'blob') {
    const { deleteFromBlob } = await import('@/lib/uploads/providers/blob/client')
    await deleteFromBlob(params.stagingKey, createBlobConfig(config))
  } else {
    const { deleteFromGcs } = await import('@/lib/uploads/providers/gcs/client')
    await deleteFromGcs(params.stagingKey, createGcsConfig(config))
  }
}

export async function writeLocalPutObject(params: {
  uploadId: string
  stagingKey: string
  body: ReadableStream<Uint8Array>
  expectedSize: number
  contentType: string
  metadata: Record<string, string>
}): Promise<void> {
  assertLocalStagingKey(params.stagingKey, params.uploadId)
  const { Readable, Transform } = await import('node:stream')
  const directory = localUploadDirectory(params.uploadId)
  const destination = localObjectPath(params.stagingKey)
  const temporary = join(directory, `.put-${generateId()}`)
  const temporaryMetadata = `${temporary}${LOCAL_UPLOAD_METADATA_SUFFIX}`
  await mkdir(dirname(destination), { recursive: true })
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
    await rename(temporary, destination)
    try {
      await rename(temporaryMetadata, localMetadataPath(params.stagingKey))
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
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
  return join(UPLOAD_DIR_SERVER, '.multipart', uploadId)
}

function localUploadDirectory(uploadId: string): string {
  return join(UPLOAD_DIR_SERVER, 'upload-sessions', uploadId)
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
  stagingKey: string,
  parts: CompletedUploadPart[],
  contentType: string,
  metadata: Record<string, string>
): Promise<void> {
  assertLocalStagingKey(stagingKey, uploadId)
  const destination = localObjectPath(stagingKey)
  const temporary = join(localUploadDirectory(uploadId), `.multipart-${generateId()}`)
  const temporaryMetadata = `${temporary}${LOCAL_UPLOAD_METADATA_SUFFIX}`
  await mkdir(dirname(destination), { recursive: true })
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
    await rename(temporary, destination)
    try {
      await rename(temporaryMetadata, localMetadataPath(stagingKey))
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
    await rm(localPartsDirectory(uploadId), { recursive: true, force: true })
  } catch (error) {
    await Promise.allSettled([
      rm(temporary, { force: true }),
      rm(temporaryMetadata, { force: true }),
    ])
    throw error
  }
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

async function promoteLocalObject(
  sourceKey: string,
  destinationKey: string,
  sourceVersion: string
): Promise<void> {
  const source = localObjectPath(sourceKey)
  const sourceMetadata = localMetadataPath(sourceKey)
  const destination = localObjectPath(destinationKey)
  const destinationMetadata = localMetadataPath(destinationKey)
  const metadata = await readLocalMetadata(sourceMetadata)
  await mkdir(dirname(destination), { recursive: true })

  let createdMetadata = false
  try {
    await link(sourceMetadata, destinationMetadata)
    createdMetadata = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readLocalMetadata(destinationMetadata)
    if (existing.uploadId !== metadata.uploadId) throw error
  }

  try {
    await link(source, destination)
  } catch (error) {
    if (createdMetadata) await rm(destinationMetadata, { force: true })
    throw error
  }

  const destinationStat = await stat(destination)
  if (localVersion(destinationStat) !== sourceVersion) {
    await Promise.allSettled([
      rm(destination, { force: true }),
      ...(createdMetadata ? [rm(destinationMetadata, { force: true })] : []),
    ])
    throw new Error('Local staging object changed during promotion')
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

function assertLocalStagingKey(stagingKey: string, uploadId: string): void {
  if (!stagingKey.startsWith(`upload-sessions/${uploadId}/`)) {
    throw new Error('Local staging key does not belong to this upload')
  }
}

function requiredEtag(provider: 's3' | 'gcs', part: CompletedUploadPart): string {
  if (!part.etag) throw new Error(`Missing etag for ${provider} part ${part.partNumber}`)
  return part.etag
}
