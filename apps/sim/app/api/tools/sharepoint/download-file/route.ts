import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { sharepointDownloadFileContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

export const dynamic = 'force-dynamic'

/** Microsoft Graph API error response structure */
interface GraphApiError {
  error?: {
    code?: string
    message?: string
  }
}

/** Microsoft Graph API drive item metadata response */
interface DriveItemMetadata {
  id?: string
  name?: string
  folder?: Record<string, unknown>
  file?: {
    mimeType?: string
  }
}

const logger = createLogger('SharepointDownloadFileAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SharePoint download attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(sharepointDownloadFileContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, driveId, itemId, fileName } = parsed.data.body
    const authHeader = `Bearer ${accessToken}`

    logger.info(`[${requestId}] Getting file metadata from SharePoint`, { driveId, itemId })

    const metadataUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`
    const metadataUrlValidation = await validateUrlWithDNS(metadataUrl, 'metadataUrl')
    if (!metadataUrlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: metadataUrlValidation.error },
        { status: 400 }
      )
    }

    const metadataResponse = await secureFetchWithPinnedIP(
      metadataUrl,
      metadataUrlValidation.resolvedIP!,
      {
        headers: { Authorization: authHeader },
      }
    )

    if (!metadataResponse.ok) {
      const errorDetails = (await metadataResponse.json().catch(() => ({}))) as GraphApiError
      logger.error(`[${requestId}] Failed to get file metadata`, {
        status: metadataResponse.status,
        error: errorDetails,
      })
      return NextResponse.json(
        { success: false, error: errorDetails.error?.message || 'Failed to get file metadata' },
        { status: 400 }
      )
    }

    const metadata = (await metadataResponse.json()) as DriveItemMetadata

    if (metadata.folder && !metadata.file) {
      logger.error(`[${requestId}] Attempted to download a folder`, {
        itemId: metadata.id,
        itemName: metadata.name,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Cannot download folder "${metadata.name}". Please select a file instead.`,
        },
        { status: 400 }
      )
    }

    const mimeType = metadata.file?.mimeType || 'application/octet-stream'

    logger.info(`[${requestId}] Downloading file from SharePoint`, { driveId, itemId, mimeType })

    const downloadUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`
    const downloadUrlValidation = await validateUrlWithDNS(downloadUrl, 'downloadUrl')
    if (!downloadUrlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: downloadUrlValidation.error },
        { status: 400 }
      )
    }

    const downloadResponse = await secureFetchWithPinnedIP(
      downloadUrl,
      downloadUrlValidation.resolvedIP!,
      {
        headers: { Authorization: authHeader },
        // The content endpoint 302s to a preauthenticated URL on a different origin that needs no auth.
        stripAuthOnRedirect: true,
        maxResponseBytes: MAX_FILE_SIZE,
      }
    )

    if (!downloadResponse.ok) {
      const downloadError = (await downloadResponse.json().catch(() => ({}))) as GraphApiError
      logger.error(`[${requestId}] Failed to download file`, {
        status: downloadResponse.status,
        error: downloadError,
      })
      return NextResponse.json(
        { success: false, error: downloadError.error?.message || 'Failed to download file' },
        { status: 400 }
      )
    }

    const arrayBuffer = await downloadResponse.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)

    const resolvedName = fileName || metadata.name || 'download'

    logger.info(`[${requestId}] File downloaded successfully`, {
      driveId,
      itemId,
      name: resolvedName,
      size: fileBuffer.length,
      mimeType,
    })

    const base64Data = fileBuffer.toString('base64')

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType,
          data: base64Data,
          size: fileBuffer.length,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error downloading SharePoint file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
