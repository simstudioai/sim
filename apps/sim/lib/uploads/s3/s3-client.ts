import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/lib/env'
import { S3_CONFIG } from '@/lib/uploads/setup'

// Lazily create a single S3 client instance.
let _s3Client: S3Client | null = null

export function getS3Client(): S3Client {
  if (_s3Client) return _s3Client

  const { region } = S3_CONFIG

  if (!region) {
    throw new Error(
      'AWS region is missing – set AWS_REGION in your environment or disable S3 uploads.'
    )
  }

  // Only pass explicit credentials if both environment variables are available.
  // Otherwise, fall back to the AWS SDK default credential provider chain (e.g. EC2/ECS roles, shared config files, etc.).
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
 * Sanitize a filename for use in S3 metadata headers
 * S3 metadata headers must contain only ASCII printable characters (0x20-0x7E)
 * and cannot contain certain special characters
 */
export function sanitizeFilenameForMetadata(filename: string): string {
  return (
    filename
      // Remove non-ASCII characters (keep only printable ASCII 0x20-0x7E)
      .replace(/[^\x20-\x7E]/g, '')
      // Remove characters that are problematic in HTTP headers
      .replace(/["\\]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim() ||
    // Provide fallback if completely sanitized
    'file'
  )
}

/**
 * File information structure
 */
export interface FileInfo {
  path: string // Path to access the file
  key: string // S3 key or local filename
  name: string // Original filename
  size: number // File size in bytes
  type: string // MIME type
}

/**
 * Custom S3 configuration
 */
export interface CustomS3Config {
  bucket: string
  region: string
}

/**
 * Upload a file to S3
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToS3(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to S3 with custom bucket configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom S3 configuration (bucket and region)
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadToS3(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: CustomS3Config,
  size?: number
): Promise<FileInfo>

export async function uploadToS3(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomS3Config | number,
  size?: number
): Promise<FileInfo> {
  // Handle overloaded parameters
  let config: CustomS3Config
  let fileSize: number

  if (typeof configOrSize === 'object') {
    // Custom config provided
    config = configOrSize
    fileSize = size ?? file.length
  } else {
    // Use default config
    config = { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
    fileSize = configOrSize ?? file.length
  }

  // Create a unique filename with timestamp to prevent collisions
  // Use a simple timestamp without directory structure
  const safeFileName = fileName.replace(/\s+/g, '-') // Replace spaces with hyphens
  const uniqueKey = `${Date.now()}-${safeFileName}`

  // Sanitize filename for S3 metadata (only allow ASCII printable characters)
  const sanitizedOriginalName = fileName
    .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII characters
    .replace(/["\\]/g, '') // Remove quotes and backslashes
    .trim()

  const s3Client = getS3Client()

  // Upload the file to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: uniqueKey,
      Body: file,
      ContentType: contentType,
      // Add some useful metadata with sanitized values
      Metadata: {
        originalName: encodeURIComponent(fileName), // Encode filename to prevent invalid characters in HTTP headers
        uploadedAt: new Date().toISOString(),
      },
    })
  )

  // Create a path for API to serve the file
  const servePath = `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName, // Return the actual original filename in the response
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
  customConfig: CustomS3Config,
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
export async function downloadFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: key,
  })

  const response = await getS3Client().send(command)
  const stream = response.Body as any

  // Convert stream to buffer
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
export async function deleteFromS3(key: string) {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: S3_CONFIG.bucket,
      Key: key,
    })
  )
}
