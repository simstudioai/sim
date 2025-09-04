import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { S3_KB_CONFIG } from '@/lib/uploads/setup'

const logger = createLogger('MultipartUploadAPI')

interface InitiateMultipartRequest {
  fileName: string
  contentType: string
  fileSize: number
}

interface GetPartUrlsRequest {
  uploadId: string
  key: string
  partNumbers: number[]
}

interface CompleteMultipartRequest {
  uploadId: string
  key: string
  parts: Array<{
    ETag: string
    PartNumber: number
  }>
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const action = request.nextUrl.searchParams.get('action')

    if (!isUsingCloudStorage() || getStorageProvider() !== 's3') {
      return NextResponse.json(
        { error: 'Multipart upload is only available with S3 storage' },
        { status: 400 }
      )
    }

    const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
    const s3Client = getS3Client()

    switch (action) {
      case 'initiate': {
        const data: InitiateMultipartRequest = await request.json()
        const { fileName, contentType } = data

        const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
        const uniqueKey = `kb/${uuidv4()}-${safeFileName}`

        const command = new CreateMultipartUploadCommand({
          Bucket: S3_KB_CONFIG.bucket,
          Key: uniqueKey,
          ContentType: contentType,
          Metadata: {
            originalName: fileName,
            uploadedAt: new Date().toISOString(),
            purpose: 'knowledge-base',
          },
        })

        const response = await s3Client.send(command)

        logger.info(`Initiated multipart upload for ${fileName}: ${response.UploadId}`)

        return NextResponse.json({
          uploadId: response.UploadId,
          key: uniqueKey,
        })
      }

      case 'get-part-urls': {
        const data: GetPartUrlsRequest = await request.json()
        const { uploadId, key, partNumbers } = data

        const presignedUrls = await Promise.all(
          partNumbers.map(async (partNumber) => {
            const command = new UploadPartCommand({
              Bucket: S3_KB_CONFIG.bucket,
              Key: key,
              PartNumber: partNumber,
              UploadId: uploadId,
            })

            const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 })
            return { partNumber, url }
          })
        )

        return NextResponse.json({ presignedUrls })
      }

      case 'complete': {
        const data: CompleteMultipartRequest = await request.json()
        const { uploadId, key, parts } = data

        const command = new CompleteMultipartUploadCommand({
          Bucket: S3_KB_CONFIG.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
          },
        })

        const response = await s3Client.send(command)

        logger.info(`Completed multipart upload for key ${key}`)

        const finalPath = `/api/files/serve/s3/${encodeURIComponent(key)}`

        return NextResponse.json({
          success: true,
          location: response.Location,
          path: finalPath,
          key,
        })
      }

      case 'abort': {
        const data = await request.json()
        const { uploadId, key } = data

        const command = new AbortMultipartUploadCommand({
          Bucket: S3_KB_CONFIG.bucket,
          Key: key,
          UploadId: uploadId,
        })

        await s3Client.send(command)

        logger.info(`Aborted multipart upload for key ${key}`)

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: initiate, get-part-urls, complete, or abort' },
          { status: 400 }
        )
    }
  } catch (error) {
    logger.error('Multipart upload error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Multipart upload failed' },
      { status: 500 }
    )
  }
}
