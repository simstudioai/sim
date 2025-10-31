import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { generatePresignedDownloadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { getBaseUrl } from '@/lib/urls/utils'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { key, name, isExecutionFile, context } = body

    if (!key) {
      return createErrorResponse(new Error('File key is required'), 400)
    }

    logger.info(`Generating download URL for file: ${name || key}`)

    let storageContext: StorageContext = context || 'general'

    if (isExecutionFile && !context) {
      storageContext = 'execution'
      logger.info(`Using execution context for file: ${key}`)
    }

    if (hasCloudStorage()) {
      try {
        const downloadUrl = await generatePresignedDownloadUrl(
          key,
          storageContext,
          5 * 60 // 5 minutes
        )

        logger.info(`Generated download URL for ${storageContext} file: ${key}`)

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
      const downloadUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`

      logger.info(`Using local storage path for file: ${key}`)

      return NextResponse.json({
        downloadUrl,
        expiresIn: null,
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
