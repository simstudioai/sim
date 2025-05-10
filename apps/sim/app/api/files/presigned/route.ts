import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client } from '@/lib/uploads/s3-client'
import { S3_CONFIG, USE_S3_STORAGE } from '@/lib/uploads/setup'
import { createErrorResponse, createOptionsResponse } from '../utils'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('PresignedUploadAPI')

interface PresignedUrlRequest {
  fileName: string
  contentType: string
  fileSize: number
}

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const data: PresignedUrlRequest = await request.json()
    const { fileName, contentType, fileSize } = data

    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 })
    }

    // Only proceed if S3 storage is enabled
    if (!USE_S3_STORAGE) {
      return NextResponse.json({ 
        error: 'Direct uploads are only available when S3 storage is enabled',
        directUploadSupported: false 
      }, { status: 400 })
    }

    // Create a unique key for the file
    const safeFileName = fileName.replace(/\s+/g, '-')
    const uniqueKey = `${Date.now()}-${uuidv4()}-${safeFileName}`

    // Create the S3 command
    const command = new PutObjectCommand({
      Bucket: S3_CONFIG.bucket,
      Key: uniqueKey,
      ContentType: contentType,
      Metadata: {
        originalName: fileName,
        uploadedAt: new Date().toISOString()
      }
    })

    // Generate the presigned URL
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 })

    // Create a path for API to serve the file
    const servePath = `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`
    
    logger.info(`Generated presigned URL for ${fileName} (${uniqueKey})`)

    return NextResponse.json({
      presignedUrl,
      fileInfo: {
        path: servePath,
        key: uniqueKey,
        name: fileName,
        size: fileSize,
        type: contentType
      },
      directUploadSupported: true
    })
  } catch (error) {
    logger.error('Error generating presigned URL:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('Failed to generate presigned URL'))
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return createOptionsResponse()
} 