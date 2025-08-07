import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getPresignedUrl, getPresignedUrlWithConfig, isUsingCloudStorage } from '@/lib/uploads'
import { BLOB_EXECUTION_FILES_CONFIG, S3_EXECUTION_FILES_CONFIG } from '@/lib/uploads/setup'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { key, name, storageProvider, bucketName, isExecutionFile } = body

    if (!key) {
      return createErrorResponse(new Error('File key is required'), 400)
    }

    logger.info(`Generating download URL for file: ${name || key}`)

    if (isUsingCloudStorage()) {
      // Generate a fresh 5-minute presigned URL for cloud storage
      try {
        let downloadUrl: string

        // Use execution files storage if flagged as execution file
        if (isExecutionFile) {
          logger.info(`Using execution files storage for file: ${key}`)
          downloadUrl = await getPresignedUrlWithConfig(
            key,
            {
              bucket: S3_EXECUTION_FILES_CONFIG.bucket,
              region: S3_EXECUTION_FILES_CONFIG.region,
            },
            5 * 60 // 5 minutes
          )
        } else if (storageProvider && (storageProvider === 's3' || storageProvider === 'blob')) {
          // Use explicitly specified storage provider (legacy support)
          logger.info(`Using specified storage provider '${storageProvider}' for file: ${key}`)

          if (storageProvider === 's3') {
            downloadUrl = await getPresignedUrlWithConfig(
              key,
              {
                bucket: bucketName || S3_EXECUTION_FILES_CONFIG.bucket,
                region: S3_EXECUTION_FILES_CONFIG.region,
              },
              5 * 60 // 5 minutes
            )
          } else {
            // blob
            downloadUrl = await getPresignedUrlWithConfig(
              key,
              {
                accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
                accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
                connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
                containerName: bucketName || BLOB_EXECUTION_FILES_CONFIG.containerName,
              },
              5 * 60 // 5 minutes
            )
          }
        } else {
          // Use default storage (regular uploads)
          logger.info(`Using default storage for file: ${key}`)
          downloadUrl = await getPresignedUrl(key, 5 * 60) // 5 minutes
        }

        return NextResponse.json({
          downloadUrl,
          expiresIn: 300, // 5 minutes in seconds
          fileName: name || key.split('/').pop() || 'download',
        })
      } catch (error) {
        logger.error(`Failed to generate presigned URL for ${key}:`, error)
        return createErrorResponse(
          error instanceof Error ? error : new Error('Failed to generate download URL'),
          500
        )
      }
    } else {
      // For local storage, return the direct path
      const downloadUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/files/serve/${key}`

      return NextResponse.json({
        downloadUrl,
        expiresIn: null, // Local URLs don't expire
        fileName: name || key.split('/').pop() || 'download',
      })
    }
  } catch (error) {
    logger.error('Error in file download endpoint:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Internal server error'),
      500
    )
  }
}
