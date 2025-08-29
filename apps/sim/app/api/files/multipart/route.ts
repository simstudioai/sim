import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { BLOB_KB_CONFIG } from '@/lib/uploads/setup'

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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const action = request.nextUrl.searchParams.get('action')

    if (!isUsingCloudStorage()) {
      return NextResponse.json(
        { error: 'Multipart upload is only available with cloud storage (S3 or Azure Blob)' },
        { status: 400 }
      )
    }

    const storageProvider = getStorageProvider()

    switch (action) {
      case 'initiate': {
        const data: InitiateMultipartRequest = await request.json()
        const { fileName, contentType, fileSize } = data

        if (storageProvider === 's3') {
          const { initiateS3MultipartUpload } = await import('@/lib/uploads/s3/s3-client')

          const result = await initiateS3MultipartUpload({
            fileName,
            contentType,
            fileSize,
          })

          logger.info(`Initiated S3 multipart upload for ${fileName}: ${result.uploadId}`)

          return NextResponse.json({
            uploadId: result.uploadId,
            key: result.key,
          })
        }
        if (storageProvider === 'blob') {
          const { initiateMultipartUpload } = await import('@/lib/uploads/blob/blob-client')

          const result = await initiateMultipartUpload({
            fileName,
            contentType,
            fileSize,
            customConfig: {
              containerName: BLOB_KB_CONFIG.containerName,
              accountName: BLOB_KB_CONFIG.accountName,
              accountKey: BLOB_KB_CONFIG.accountKey,
              connectionString: BLOB_KB_CONFIG.connectionString,
            },
          })

          logger.info(`Initiated Azure multipart upload for ${fileName}: ${result.uploadId}`)

          return NextResponse.json({
            uploadId: result.uploadId,
            key: result.key,
          })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'get-part-urls': {
        const data: GetPartUrlsRequest = await request.json()
        const { uploadId, key, partNumbers } = data

        if (storageProvider === 's3') {
          const { getS3MultipartPartUrls } = await import('@/lib/uploads/s3/s3-client')

          const presignedUrls = await getS3MultipartPartUrls(key, uploadId, partNumbers)

          return NextResponse.json({ presignedUrls })
        }
        if (storageProvider === 'blob') {
          const { getMultipartPartUrls } = await import('@/lib/uploads/blob/blob-client')

          const presignedUrls = await getMultipartPartUrls(key, uploadId, partNumbers, {
            containerName: BLOB_KB_CONFIG.containerName,
            accountName: BLOB_KB_CONFIG.accountName,
            accountKey: BLOB_KB_CONFIG.accountKey,
            connectionString: BLOB_KB_CONFIG.connectionString,
          })

          return NextResponse.json({ presignedUrls })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'complete': {
        const data = await request.json()

        // Handle batch completion
        if ('uploads' in data) {
          const results = await Promise.all(
            data.uploads.map(async (upload: any) => {
              const { uploadId, key } = upload

              if (storageProvider === 's3') {
                const { completeS3MultipartUpload } = await import('@/lib/uploads/s3/s3-client')
                const parts = upload.parts // S3 format: { ETag, PartNumber }

                const result = await completeS3MultipartUpload(key, uploadId, parts)

                return {
                  success: true,
                  location: result.location,
                  path: result.path,
                  key: result.key,
                }
              }
              if (storageProvider === 'blob') {
                const { completeMultipartUpload } = await import('@/lib/uploads/blob/blob-client')
                const parts = upload.parts // Azure format: { blockId, partNumber }

                const result = await completeMultipartUpload(key, uploadId, parts, {
                  containerName: BLOB_KB_CONFIG.containerName,
                  accountName: BLOB_KB_CONFIG.accountName,
                  accountKey: BLOB_KB_CONFIG.accountKey,
                  connectionString: BLOB_KB_CONFIG.connectionString,
                })

                return {
                  success: true,
                  location: result.location,
                  path: result.path,
                  key: result.key,
                }
              }

              throw new Error(`Unsupported storage provider: ${storageProvider}`)
            })
          )

          logger.info(`Completed ${data.uploads.length} multipart uploads`)
          return NextResponse.json({ results })
        }

        // Handle single completion
        const { uploadId, key, parts } = data

        if (storageProvider === 's3') {
          const { completeS3MultipartUpload } = await import('@/lib/uploads/s3/s3-client')

          const result = await completeS3MultipartUpload(key, uploadId, parts)

          logger.info(`Completed S3 multipart upload for key ${key}`)

          return NextResponse.json({
            success: true,
            location: result.location,
            path: result.path,
            key: result.key,
          })
        }
        if (storageProvider === 'blob') {
          const { completeMultipartUpload } = await import('@/lib/uploads/blob/blob-client')

          const result = await completeMultipartUpload(key, uploadId, parts, {
            containerName: BLOB_KB_CONFIG.containerName,
            accountName: BLOB_KB_CONFIG.accountName,
            accountKey: BLOB_KB_CONFIG.accountKey,
            connectionString: BLOB_KB_CONFIG.connectionString,
          })

          logger.info(`Completed Azure multipart upload for key ${key}`)

          return NextResponse.json({
            success: true,
            location: result.location,
            path: result.path,
            key: result.key,
          })
        }

        return NextResponse.json(
          { error: `Unsupported storage provider: ${storageProvider}` },
          { status: 400 }
        )
      }

      case 'abort': {
        const data = await request.json()
        const { uploadId, key } = data

        if (storageProvider === 's3') {
          const { abortS3MultipartUpload } = await import('@/lib/uploads/s3/s3-client')

          await abortS3MultipartUpload(key, uploadId)

          logger.info(`Aborted S3 multipart upload for key ${key}`)
        } else if (storageProvider === 'blob') {
          const { abortMultipartUpload } = await import('@/lib/uploads/blob/blob-client')

          await abortMultipartUpload(key, uploadId, {
            containerName: BLOB_KB_CONFIG.containerName,
            accountName: BLOB_KB_CONFIG.accountName,
            accountKey: BLOB_KB_CONFIG.accountKey,
            connectionString: BLOB_KB_CONFIG.connectionString,
          })

          logger.info(`Aborted Azure multipart upload for key ${key}`)
        } else {
          return NextResponse.json(
            { error: `Unsupported storage provider: ${storageProvider}` },
            { status: 400 }
          )
        }

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
