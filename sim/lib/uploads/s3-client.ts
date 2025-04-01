import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createLogger } from '@/lib/logs/console-logger'
import { S3_CONFIG } from './setup'

const logger = createLogger('S3Client')

// Create an S3 client
export const s3Client = new S3Client({
  region: S3_CONFIG.region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
})

/**
 * File information structure
 */
export interface FileInfo {
  path: string      // Path to access the file
  key: string       // S3 key or local filename
  name: string      // Original filename
  size: number      // File size in bytes
  type: string      // MIME type
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
): Promise<FileInfo> {
  // Create a unique filename with timestamp to prevent collisions
  // Use a simple timestamp without directory structure
  const safeFileName = fileName.replace(/\s+/g, '-') // Replace spaces with hyphens
  const uniqueKey = `${Date.now()}-${safeFileName}`
  
  // Upload the file to S3
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: uniqueKey,
    Body: file,
    ContentType: contentType,
    // Add some useful metadata
    Metadata: {
      originalName: fileName,
      uploadedAt: new Date().toISOString()
    }
  }))

  // Create a path for API to serve the file
  const servePath = `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`
  
  return {
    path: servePath,
    key: uniqueKey,
    name: fileName,
    size: size ?? file.length,
    type: contentType
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
    Key: key
  })
  
  return getSignedUrl(s3Client, command, { expiresIn })
}

/**
 * Download a file from S3
 * @param key S3 object key
 * @returns File buffer
 */
export async function downloadFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: key
  })
  
  const response = await s3Client.send(command)
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
  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: key
  }))
} 