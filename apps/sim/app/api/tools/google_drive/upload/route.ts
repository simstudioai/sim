import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'
import {
  GOOGLE_WORKSPACE_MIME_TYPES,
  handleSheetsFormat,
  SOURCE_MIME_TYPES,
} from '@/tools/google_drive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveUploadAPI')

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/upload/drive/v3/files'

const GoogleDriveUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: z.any().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
})

/**
 * Build multipart upload body for Google Drive API
 */
function buildMultipartBody(
  metadata: Record<string, any>,
  fileBuffer: Buffer,
  mimeType: string,
  boundary: string
): string {
  const parts: string[] = []

  parts.push(`--${boundary}`)
  parts.push('Content-Type: application/json; charset=UTF-8')
  parts.push('')
  parts.push(JSON.stringify(metadata))

  parts.push(`--${boundary}`)
  parts.push(`Content-Type: ${mimeType}`)
  parts.push('Content-Transfer-Encoding: base64')
  parts.push('')
  parts.push(fileBuffer.toString('base64'))

  parts.push(`--${boundary}--`)

  return parts.join('\r\n')
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Google Drive upload attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Google Drive upload request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = GoogleDriveUploadSchema.parse(body)

    logger.info(`[${requestId}] Uploading file to Google Drive`, {
      fileName: validatedData.fileName,
      mimeType: validatedData.mimeType,
      folderId: validatedData.folderId,
      hasFile: !!validatedData.file,
    })

    if (!validatedData.file) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file provided. Use the text content field for text-only uploads.',
        },
        { status: 400 }
      )
    }

    // Process file - convert to UserFile format if needed
    const fileData = validatedData.file

    let userFile
    try {
      userFile = processSingleFileToUserFile(fileData, requestId, logger)
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process file',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Downloading file from storage`, {
      fileName: userFile.name,
      key: userFile.key,
      size: userFile.size,
    })

    let fileBuffer: Buffer

    try {
      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } catch (error) {
      logger.error(`[${requestId}] Failed to download file:`, error)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 500 }
      )
    }

    let uploadMimeType = validatedData.mimeType || userFile.type || 'application/octet-stream'
    const requestedMimeType = validatedData.mimeType || userFile.type || 'application/octet-stream'

    if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
      uploadMimeType = SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
      logger.info(`[${requestId}] Converting to Google Workspace type`, {
        requestedMimeType,
        uploadMimeType,
      })
    }

    if (requestedMimeType === 'application/vnd.google-apps.spreadsheet') {
      try {
        const textContent = fileBuffer.toString('utf-8')
        const { csv } = handleSheetsFormat(textContent)
        if (csv !== undefined) {
          fileBuffer = Buffer.from(csv, 'utf-8')
          uploadMimeType = 'text/csv'
          logger.info(`[${requestId}] Converted to CSV for Google Sheets upload`)
        }
      } catch (error) {
        logger.warn(`[${requestId}] Could not convert to CSV, uploading as-is:`, error)
      }
    }

    const metadata: {
      name: string
      mimeType: string
      parents?: string[]
    } = {
      name: validatedData.fileName,
      mimeType: requestedMimeType,
    }

    if (validatedData.folderId && validatedData.folderId.trim() !== '') {
      metadata.parents = [validatedData.folderId.trim()]
    }

    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const multipartBody = buildMultipartBody(metadata, fileBuffer, uploadMimeType, boundary)

    logger.info(`[${requestId}] Uploading to Google Drive via multipart upload`, {
      fileName: validatedData.fileName,
      size: fileBuffer.length,
      uploadMimeType,
      requestedMimeType,
    })

    const uploadResponse = await fetch(
      `${GOOGLE_DRIVE_API_BASE}?uploadType=multipart&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(multipartBody, 'utf-8').toString(),
        },
        body: multipartBody,
      }
    )

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      logger.error(`[${requestId}] Google Drive API error:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Google Drive API error: ${uploadResponse.statusText}`,
        },
        { status: uploadResponse.status }
      )
    }

    const uploadData = await uploadResponse.json()
    const fileId = uploadData.id

    logger.info(`[${requestId}] File uploaded successfully`, { fileId })

    if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
      logger.info(`[${requestId}] Updating file name to ensure it persists after conversion`)

      const updateNameResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${validatedData.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: validatedData.fileName,
          }),
        }
      )

      if (!updateNameResponse.ok) {
        logger.warn(
          `[${requestId}] Failed to update filename after conversion, but content was uploaded`
        )
      }
    }

    const finalFileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
      {
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
      }
    )

    const finalFile = await finalFileResponse.json()

    logger.info(`[${requestId}] Upload complete`, {
      fileId: finalFile.id,
      fileName: finalFile.name,
      webViewLink: finalFile.webViewLink,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          id: finalFile.id,
          name: finalFile.name,
          mimeType: finalFile.mimeType,
          webViewLink: finalFile.webViewLink,
          webContentLink: finalFile.webContentLink,
          size: finalFile.size,
          createdTime: finalFile.createdTime,
          modifiedTime: finalFile.modifiedTime,
          parents: finalFile.parents,
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error uploading file to Google Drive:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
