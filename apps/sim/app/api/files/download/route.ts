import { type NextRequest, NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads/config'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { createErrorResponse, FileNotFoundError } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized download URL request', {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const body = await request.json()
    const { key, name, isExecutionFile, context, url } = body

    if (!key) {
      return createErrorResponse(new Error('File key is required'), 400)
    }

    if (key.startsWith('url/')) {
      if (!url) {
        return createErrorResponse(new Error('URL is required for URL-type files'), 400)
      }

      return NextResponse.json({
        downloadUrl: url,
        expiresIn: null,
        fileName: name || key.split('/').pop() || 'download',
      })
    }

    let storageContext: StorageContext = context || 'general'

    if (isExecutionFile && !context) {
      storageContext = 'execution'
      logger.info(`Using execution context for file: ${key}`)
    }

    const hasAccess = await verifyFileAccess(
      key,
      userId,
      undefined, // customConfig
      storageContext, // context
      !hasCloudStorage() // isLocal
    )

    if (!hasAccess) {
      logger.warn('Unauthorized download URL request', { userId, key, context: storageContext })
      throw new FileNotFoundError(`File not found: ${key}`)
    }

    const { getBaseUrl } = await import('@/lib/urls/utils')
    const downloadUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`

    logger.info(`Generated download URL for ${storageContext} file: ${key}`)

    return NextResponse.json({
      downloadUrl,
      expiresIn: null,
      fileName: name || key.split('/').pop() || 'download',
    })
  } catch (error) {
    logger.error('Error in file download endpoint:', error)

    if (error instanceof FileNotFoundError) {
      return createErrorResponse(error)
    }

    return createErrorResponse(
      error instanceof Error ? error : new Error('Internal server error'),
      500
    )
  }
}
