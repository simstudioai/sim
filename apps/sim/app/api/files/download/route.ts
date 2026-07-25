import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { fileDownloadContract } from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import { createErrorResponse, FileNotFoundError } from '@/app/api/files/utils'

const logger = createLogger('FileDownload')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized download URL request', {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      fileDownloadContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(
            new Error(getValidationErrorMessage(error, 'Invalid request data')),
            400
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const { key, name, url } = parsed.data.body

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

    // Derive context from the trusted key prefix, mirroring the serve route this URL
    // delegates to, which re-derives context from the key and ignores any client-supplied value.
    const storageContext = inferContextFromKey(key)

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

    const { getBaseUrl } = await import('@/lib/core/utils/urls')
    const downloadUrl = `${getBaseUrl()}/api/files/serve/${encodeURIComponent(key)}?context=${storageContext}`

    logger.info(`Generated download URL for ${storageContext} file: ${key}`)

    const downloadName = name || key.split('/').pop() || 'download'
    recordAudit({
      workspaceId: null,
      actorId: userId,
      action: AuditAction.FILE_DOWNLOADED,
      resourceType: AuditResourceType.FILE,
      resourceName: downloadName,
      description: `Downloaded file "${downloadName}"`,
      metadata: { key, fileName: downloadName, context: storageContext },
      request,
    })
    captureServerEvent(userId, 'file_downloaded', {
      is_bulk: false,
      file_count: 1,
    })

    return NextResponse.json({
      downloadUrl,
      expiresIn: null,
      fileName: downloadName,
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
})
