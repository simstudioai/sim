import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import type { GoogleDriveFile, GoogleDriveRevision } from '@/tools/google_drive/types'
import {
  ALL_FILE_FIELDS,
  ALL_REVISION_FIELDS,
  DEFAULT_EXPORT_FORMATS,
  GOOGLE_WORKSPACE_MIME_TYPES,
} from '@/tools/google_drive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveDownloadAPI')

/** Google API error response structure */
interface GoogleApiErrorResponse {
  error?: {
    message?: string
    code?: number
    status?: string
  }
}

/** Google Drive revisions list response */
interface GoogleDriveRevisionsResponse {
  revisions?: GoogleDriveRevision[]
  nextPageToken?: string
}

const GoogleDriveDownloadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileId: z.string().min(1, 'File ID is required'),
  mimeType: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  includeRevisions: z.boolean().optional().default(true),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Google Drive download attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = GoogleDriveDownloadSchema.parse(body)

    const {
      accessToken,
      fileId,
      mimeType: exportMimeType,
      fileName,
      includeRevisions,
    } = validatedData
    const authHeader = `Bearer ${accessToken}`

    logger.info(`[${requestId}] Getting file metadata from Google Drive`, { fileId })

    const metadataUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${ALL_FILE_FIELDS}&supportsAllDrives=true`
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

    let fileBuffer: Buffer
    let finalMimeType = fileMimeType

    if (GOOGLE_WORKSPACE_MIME_TYPES.includes(fileMimeType)) {
      const exportFormat = exportMimeType || DEFAULT_EXPORT_FORMATS[fileMimeType] || 'text/plain'
      finalMimeType = exportFormat

      logger.info(`[${requestId}] Exporting Google Workspace file`, {
        fileId,
        mimeType: fileMimeType,
        exportFormat,
      })

      const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportFormat)}&supportsAllDrives=true`
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
        { headers: { Authorization: authHeader } }
      )

      if (!exportResponse.ok) {
        const exportError = (await exportResponse
          .json()
          .catch(() => ({}))) as GoogleApiErrorResponse
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

      const arrayBuffer = await exportResponse.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuffer)
    } else {
      logger.info(`[${requestId}] Downloading regular file`, { fileId, mimeType: fileMimeType })

      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`
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
        { headers: { Authorization: authHeader } }
      )

      if (!downloadResponse.ok) {
        const downloadError = (await downloadResponse
          .json()
          .catch(() => ({}))) as GoogleApiErrorResponse
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
      fileBuffer = Buffer.from(arrayBuffer)
    }

    const canReadRevisions = metadata.capabilities?.canReadRevisions === true
    if (includeRevisions && canReadRevisions) {
      try {
        const revisionsUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(${ALL_REVISION_FIELDS})&pageSize=100`
        const revisionsUrlValidation = await validateUrlWithDNS(revisionsUrl, 'revisionsUrl')
        if (revisionsUrlValidation.isValid) {
          const revisionsResponse = await secureFetchWithPinnedIP(
            revisionsUrl,
            revisionsUrlValidation.resolvedIP!,
            { headers: { Authorization: authHeader } }
          )

          if (revisionsResponse.ok) {
            const revisionsData = (await revisionsResponse.json()) as GoogleDriveRevisionsResponse
            metadata.revisions = revisionsData.revisions
            logger.info(`[${requestId}] Fetched file revisions`, {
              fileId,
              revisionCount: metadata.revisions?.length || 0,
            })
          }
        }
      } catch (error) {
        logger.warn(`[${requestId}] Error fetching revisions, continuing without them`, { error })
      }
    }

    const resolvedName = fileName || metadata.name || 'download'

    logger.info(`[${requestId}] File downloaded successfully`, {
      fileId,
      name: resolvedName,
      size: fileBuffer.length,
      mimeType: finalMimeType,
    })

    const base64Data = fileBuffer.toString('base64')

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: finalMimeType,
          data: base64Data,
          size: fileBuffer.length,
        },
        metadata,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error downloading Google Drive file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
