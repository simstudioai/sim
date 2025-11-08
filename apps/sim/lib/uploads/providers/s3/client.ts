import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/lib/env'
import { S3_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/config'
import type {
  S3Config,
  S3MultipartPart,
  S3MultipartUploadInit,
  S3PartUploadUrl,
} from '@/lib/uploads/providers/s3/types'
import type { FileInfo } from '@/lib/uploads/shared/types'
import {
  sanitizeFilenameForMetadata,
  sanitizeStorageMetadata,
} from '@/lib/uploads/utils/file-utils'

let _s3Client: S3Client | null = null

export function getS3Client(): S3Client {
  if (_s3Client) return _s3Client

  const { region } = S3_CONFIG

  if (!region) {
    throw new Error(
      'AWS region is missing – set AWS_REGION in your environment or disable S3 uploads.'
    )
  }

  _s3Client = new S3Client({
    region,
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  })

  return _s3Client
}

/**
 * Upload a file to S3
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param configOrSize Custom S3 configuration OR file size in bytes (optional)
 * @param size File size in bytes (required if configOrSize is S3Config, optional otherwise)
 * @param skipTimestampPrefix Skip adding timestamp prefix to filename (default: false)
 * @param metadata Optional metadata to store with the file
 * @returns Object with file information
 */
export async function uploadToS3(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: S3Config | number,
  size?: number,
  skipTimestampPrefix?: boolean,
  metadata?: Record<string, string>
): Promise<FileInfo> {
  let config: S3Config
  let fileSize: number
  let shouldSkipTimestamp: boolean

  if (typeof configOrSize === 'object') {
    config = configOrSize
    fileSize = size ?? file.length
    shouldSkipTimestamp = skipTimestampPrefix ?? false
  } else {
    config = { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
    fileSize = configOrSize ?? file.length
    shouldSkipTimestamp = skipTimestampPrefix ?? false
  }

  const safeFileName = fileName.replace(/\s+/g, '-') // Replace spaces with hyphens
  const uniqueKey = shouldSkipTimestamp ? fileName : `${Date.now()}-${safeFileName}`

  const s3Client = getS3Client()

  const s3Metadata: Record<string, string> = {
    originalName: sanitizeFilenameForMetadata(fileName),
    uploadedAt: new Date().toISOString(),
  }

  if (metadata) {
    Object.assign(s3Metadata, sanitizeStorageMetadata(metadata, 2000))
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: uniqueKey,
      Body: file,
      ContentType: contentType,
      Metadata: s3Metadata,
    })
  )

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
 * @param key S3 object key
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: key,
  })

  return getSignedUrl(getS3Client(), command, { expiresIn })
}

/**
 * Generate a presigned URL for direct file access with custom bucket
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: S3Config,
  expiresIn = 3600
) {
  const command = new GetObjectCommand({
    Bucket: customConfig.bucket,
    Key: key,
  })

  return getSignedUrl(getS3Client(), command, { expiresIn })
}

/**
 * Download a file from S3
 * @param key S3 object key
 * @returns File buffer
 */
export async function downloadFromS3(key: string): Promise<Buffer>

/**
 * Download a file from S3 with custom bucket configuration
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 * @returns File buffer
 */
export async function downloadFromS3(key: string, customConfig: S3Config): Promise<Buffer>

export async function downloadFromS3(key: string, customConfig?: S3Config): Promise<Buffer> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  })

  const response = await getS3Client().send(command)
  const stream = response.Body as any

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

/**
 * Delete a file from S3
 * @param key S3 object key
 */
export async function deleteFromS3(key: string): Promise<void>

/**
 * Delete a file from S3 with custom bucket configuration
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 */
export async function deleteFromS3(key: string, customConfig: S3Config): Promise<void>

export async function deleteFromS3(key: string, customConfig?: S3Config): Promise<void> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  )
}

/**
 * Initiate a multipart upload for S3
 */
export async function initiateS3MultipartUpload(
  options: S3MultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { fileName, contentType, customConfig } = options

  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  const { v4: uuidv4 } = await import('uuid')
  const uniqueKey = `kb/${uuidv4()}-${safeFileName}`

  const command = new CreateMultipartUploadCommand({
    Bucket: config.bucket,
    Key: uniqueKey,
    ContentType: contentType,
    Metadata: {
      originalName: sanitizeFilenameForMetadata(fileName),
      uploadedAt: new Date().toISOString(),
      purpose: 'knowledge-base',
    },
  })

  const response = await s3Client.send(command)

  if (!response.UploadId) {
    throw new Error('Failed to initiate S3 multipart upload')
  }

  return {
    uploadId: response.UploadId,
    key: uniqueKey,
  }
}

/**
 * Generate presigned URLs for uploading parts to S3
 */
export async function getS3MultipartPartUrls(
  key: string,
  uploadId: string,
  partNumbers: number[],
  customConfig?: S3Config
): Promise<S3PartUploadUrl[]> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const presignedUrls = await Promise.all(
    partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: config.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
      })

      const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 })
      return { partNumber, url }
    })
  )

  return presignedUrls
}

/**
 * Complete multipart upload for S3
 */
export async function completeS3MultipartUpload(
  key: string,
  uploadId: string,
  parts: S3MultipartPart[],
  customConfig?: S3Config
): Promise<{ location: string; path: string; key: string }> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const command = new CompleteMultipartUploadCommand({
    Bucket: config.bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    },
  })

  const response = await s3Client.send(command)
  const location =
    response.Location || `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`
  const path = `/api/files/serve/${encodeURIComponent(key)}`

  return {
    location,
    path,
    key,
  }
}

/**
 * Abort multipart upload for S3
 */
export async function abortS3MultipartUpload(
  key: string,
  uploadId: string,
  customConfig?: S3Config
): Promise<void> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const command = new AbortMultipartUploadCommand({
    Bucket: config.bucket,
    Key: key,
    UploadId: uploadId,
  })

  await s3Client.send(command)
}
