import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { googleDriveExportContract } from '@/lib/api/contracts/tools/google'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { GoogleDriveFile } from '@/tools/google_drive/types'
import {
  ALL_FILE_FIELDS,
  GOOGLE_WORKSPACE_MIME_TYPES,
  MAX_EXPORT_BYTES,
  VALID_EXPORT_FORMATS,
} from '@/tools/google_drive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveExportAPI')

/** Google API error response structure */
interface GoogleApiErrorResponse {
  error?: {
    message?: string
    code?: number
    status?: string
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Google Drive export attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      googleDriveExportContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Invalid request') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const { accessToken, fileId, mimeType: exportMimeType, fileName } = parsed.data.body
    const authHeader = `Bearer ${accessToken}`

    logger.info(`[${requestId}] Getting file metadata from Google Drive`, { fileId })

    const metadataUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`
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
      { headers: { Authorization: authHeader } }
    )

    if (!metadataResponse.ok) {
      const errorDetails = (await metadataResponse
        .json()
        .catch(() => ({}))) as GoogleApiErrorResponse
      logger.error(`[${requestId}] Failed to get file metadata`, {
        status: metadataResponse.status,
        error: errorDetails,
      })
      return NextResponse.json(
        { success: false, error: errorDetails.error?.message || 'Failed to get file metadata' },
        { status: 400 }
      )
    }

    const metadata = (await metadataResponse.json()) as GoogleDriveFile
    const fileMimeType = metadata.mimeType

    if (!GOOGLE_WORKSPACE_MIME_TYPES.includes(fileMimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Export only supports Google Workspace files (Docs, Sheets, Slides, Drawings). This file is "${fileMimeType}" — use the Download operation instead.`,
        },
        { status: 400 }
      )
    }

    const validFormats = VALID_EXPORT_FORMATS[fileMimeType]
    if (validFormats && !validFormats.includes(exportMimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: `Export format "${exportMimeType}" is not supported for this file type. Supported formats: ${validFormats.join(', ')}`,
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Exporting Google Workspace file`, {
      fileId,
      mimeType: fileMimeType,
      exportFormat: exportMimeType,
    })

    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}&supportsAllDrives=true`
    const exportUrlValidation = await validateUrlWithDNS(exportUrl, 'exportUrl')
    if (!exportUrlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: exportUrlValidation.error },
        { status: 400 }
      )
    }

    const exportResponse = await secureFetchWithPinnedIP(
      exportUrl,
      exportUrlValidation.resolvedIP!,
      {
        headers: { Authorization: authHeader },
      }
    )

    if (!exportResponse.ok) {
      const exportError = (await exportResponse.json().catch(() => ({}))) as GoogleApiErrorResponse
      logger.error(`[${requestId}] Failed to export file`, {
        status: exportResponse.status,
        error: exportError,
      })
      return NextResponse.json(
        {
          success: false,
          error: exportError.error?.message || 'Failed to export Google Workspace file',
        },
        { status: 400 }
      )
    }

    const declaredSize = Number(exportResponse.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > MAX_EXPORT_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Exported content (${declaredSize} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`,
        },
        { status: 400 }
      )
    }

    const arrayBuffer = await exportResponse.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_EXPORT_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Exported content (${arrayBuffer.byteLength} bytes) exceeds the ${MAX_EXPORT_BYTES}-byte export limit.`,
        },
        { status: 400 }
      )
    }
    const fileBuffer = Buffer.from(arrayBuffer)

    const resolvedName = fileName || metadata.name || 'export'

    logger.info(`[${requestId}] File exported successfully`, {
      fileId,
      name: resolvedName,
      size: fileBuffer.length,
      mimeType: exportMimeType,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: exportMimeType,
          data: fileBuffer.toString('base64'),
          size: fileBuffer.length,
        },
        exportedMimeType: exportMimeType,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error exporting Google Drive file:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
})
