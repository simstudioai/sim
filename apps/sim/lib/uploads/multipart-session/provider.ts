import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getErrorMessage } from '@sim/utils/errors'
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
} from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

export type MultipartStorageProvider = 's3' | 'blob' | 'gcs' | 'local'

export interface CompletedUploadPart {
  partNumber: number
  etag?: string
}

export interface MultipartPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
  expiresAt: string
}

export function multipartStorageProvider(): MultipartStorageProvider {
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
  localUploadId: string
}): Promise<{ provider: MultipartStorageProvider; providerUploadId: string | null }> {
  const { key, fileName, contentType, fileSize, context, localUploadId } = params
  const provider = multipartStorageProvider()
  const config = getStorageConfig(context)

  if (provider === 's3') {
    const { initiateS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
    const result = await initiateS3MultipartUpload({
      fileName,
      contentType,
      fileSize,
      customConfig: createS3Config(config),
      customKey: key,
      purpose: context,
    })
    return { provider, providerUploadId: result.uploadId }
  }
  if (provider === 'blob') {
    const { initiateMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
    const result = await initiateMultipartUpload({
      fileName,
      contentType,
      fileSize,
      customConfig: createBlobConfig(config),
      customKey: key,
    })
    return { provider, providerUploadId: result.uploadId }
  }
  if (provider === 'gcs') {
    const { initiateGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
    const result = await initiateGcsMultipartUpload({
      fileName,
      contentType,
      fileSize,
      customConfig: createGcsConfig(config),
      customKey: key,
      purpose: context,
    })
    return { provider, providerUploadId: result.uploadId }
  }

  await mkdir(localPartsDirectory(localUploadId), { recursive: true })
  return { provider, providerUploadId: null }
}

export async function getMultipartProviderPartUrls(params: {
  provider: MultipartStorageProvider
  providerUploadId: string | null
  key: string
  context: StorageContext
  partNumbers: number[]
  localUrl: (partNumber: number) => string
}): Promise<MultipartPartUrl[]> {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const { provider, providerUploadId, key, context, partNumbers } = params
  if (provider === 'local') {
    return partNumbers.map((partNumber) => ({
      partNumber,
      url: params.localUrl(partNumber),
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  if (!providerUploadId) throw new Error(`Missing ${provider} multipart upload id`)
  const config = getStorageConfig(context)

  if (provider === 's3') {
    const { getS3MultipartPartUrls } = await import('@/lib/uploads/providers/s3/client')
    const urls = await getS3MultipartPartUrls(
      key,
      providerUploadId,
      partNumbers,
      createS3Config(config)
    )
    return urls.map(({ partNumber, url }) => ({
      partNumber,
      url,
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  if (provider === 'blob') {
    const { getMultipartPartUrls } = await import('@/lib/uploads/providers/blob/client')
    const urls = await getMultipartPartUrls(key, partNumbers, createBlobConfig(config))
    return urls.map(({ partNumber, url }) => ({
      partNumber,
      url,
      headers: { 'Content-Type': 'application/octet-stream' },
      expiresAt,
    }))
  }
  const { getGcsMultipartPartUrls } = await import('@/lib/uploads/providers/gcs/client')
  const urls = await getGcsMultipartPartUrls(
    key,
    providerUploadId,
    partNumbers,
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
  provider: MultipartStorageProvider
  providerUploadId: string | null
  uploadId: string
  key: string
  contentType: string
  context: StorageContext
  parts: CompletedUploadPart[]
}): Promise<void> {
  const { provider, providerUploadId, uploadId, key, contentType, context, parts } = params
  if (provider === 'local') {
    await assembleLocalParts(uploadId, key, parts)
    return
  }
  if (!providerUploadId) throw new Error(`Missing ${provider} multipart upload id`)
  const config = getStorageConfig(context)
  if (provider === 's3') {
    const { completeS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
    await completeS3MultipartUpload(
      key,
      providerUploadId,
      parts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: requiredEtag(provider, part),
      })),
      createS3Config(config)
    )
    return
  }
  if (provider === 'blob') {
    const { completeMultipartUpload, deriveBlobBlockId } = await import(
      '@/lib/uploads/providers/blob/client'
    )
    await completeMultipartUpload(
      key,
      parts.map((part) => ({
        partNumber: part.partNumber,
        blockId: deriveBlobBlockId(part.partNumber),
      })),
      createBlobConfig(config),
      contentType
    )
    return
  }
  const { completeGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
  await completeGcsMultipartUpload(
    key,
    providerUploadId,
    parts.map((part) => ({
      PartNumber: part.partNumber,
      ETag: requiredEtag(provider, part),
    })),
    createGcsConfig(config)
  )
}

export async function abortMultipartProviderUpload(params: {
  provider: MultipartStorageProvider
  providerUploadId: string | null
  uploadId: string
  key: string
  context: StorageContext
}): Promise<void> {
  const { provider, providerUploadId, uploadId, key, context } = params
  if (provider === 'local') {
    await rm(localPartsDirectory(uploadId), { recursive: true, force: true })
    const destination = join(UPLOAD_DIR_SERVER, sanitizeFileKey(key))
    await rm(`${destination}.uploading-${uploadId}`, { force: true })
    return
  }
  if (!providerUploadId) throw new Error(`Missing ${provider} multipart upload id`)
  const config = getStorageConfig(context)
  if (provider === 's3') {
    const { abortS3MultipartUpload } = await import('@/lib/uploads/providers/s3/client')
    await abortS3MultipartUpload(key, providerUploadId, createS3Config(config))
    return
  }
  if (provider === 'blob') {
    const { abortMultipartUpload } = await import('@/lib/uploads/providers/blob/client')
    await abortMultipartUpload(key, createBlobConfig(config))
    return
  }
  const { abortGcsMultipartUpload } = await import('@/lib/uploads/providers/gcs/client')
  await abortGcsMultipartUpload(key, providerUploadId, createGcsConfig(config))
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
  let bytes = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > params.expectedSize) {
        callback(new Error(`Part ${params.partNumber} exceeds ${params.expectedSize} bytes`))
        return
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(params.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(destination, { flags: 'w' })
    )
    if (bytes !== params.expectedSize) {
      throw new Error(
        `Part ${params.partNumber} has ${bytes} bytes; expected ${params.expectedSize}`
      )
    }
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {})
    throw new Error(getErrorMessage(error, `Failed to store part ${params.partNumber}`), {
      cause: error,
    })
  }
}

function localPartsDirectory(uploadId: string): string {
  return join(UPLOAD_DIR_SERVER, '.multipart', uploadId)
}

function localPartPath(uploadId: string, partNumber: number): string {
  return join(localPartsDirectory(uploadId), `${partNumber}.part`)
}

async function assembleLocalParts(
  uploadId: string,
  key: string,
  parts: CompletedUploadPart[]
): Promise<void> {
  const safeKey = sanitizeFileKey(key)
  const destination = join(UPLOAD_DIR_SERVER, safeKey)
  const temporary = `${destination}.uploading-${uploadId}`
  await mkdir(dirname(destination), { recursive: true })
  await rm(temporary, { force: true })
  try {
    for (const part of parts) {
      await pipeline(
        createReadStream(localPartPath(uploadId, part.partNumber)),
        createWriteStream(temporary, { flags: 'a' })
      )
    }
    const assembled = await stat(temporary)
    if (assembled.size === 0) throw new Error('Assembled upload is empty')
    await rename(temporary, destination)
    await rm(localPartsDirectory(uploadId), { recursive: true, force: true })
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function requiredEtag(provider: 's3' | 'gcs', part: CompletedUploadPart): string {
  if (!part.etag) throw new Error(`Missing etag for ${provider} part ${part.partNumber}`)
  return part.etag
}
