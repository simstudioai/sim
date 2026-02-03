import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'

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

const logger = createLogger('OneDriveDownloadAPI')

const OneDriveDownloadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
  fileName: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OneDrive download attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = OneDriveDownloadSchema.parse(body)

    const { accessToken, fileId, fileName } = validatedData
    const authHeader = `Bearer ${accessToken}`

    logger.info(`[${requestId}] Getting file metadata from OneDrive`, { fileId })

    const metadataUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`
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

    logger.info(`[${requestId}] Downloading file from OneDrive`, { fileId, mimeType })

    const downloadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`
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
      fileId,
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
    logger.error(`[${requestId}] Error downloading OneDrive file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
