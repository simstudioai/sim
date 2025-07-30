import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getPresignedUrl, isUsingCloudStorage } from '@/lib/uploads'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { key, name } = body

    if (!key) {
      return createErrorResponse('File key is required', 400)
    }

    logger.info(`Generating download URL for file: ${name || key}`)

    if (isUsingCloudStorage()) {
      // Generate a fresh 5-minute presigned URL for cloud storage
      try {
        const downloadUrl = await getPresignedUrl(key, 5 * 60) // 5 minutes

        return NextResponse.json({
          downloadUrl,
          expiresIn: 300, // 5 minutes in seconds
          fileName: name || key.split('/').pop() || 'download',
        })
      } catch (error) {
        logger.error(`Failed to generate presigned URL for ${key}:`, error)
        return createErrorResponse('Failed to generate download URL', 500)
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
    return createErrorResponse('Internal server error', 500)
  }
}
