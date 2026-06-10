import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { googleDriveUploadContract } from '@/lib/api/contracts/tools/google'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { DriveUploadError, uploadBufferToDrive } from '@/lib/google-drive/upload-to-drive'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  GOOGLE_WORKSPACE_MIME_TYPES,
  handleSheetsFormat,
  SOURCE_MIME_TYPES,
} from '@/tools/google_drive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveUploadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
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

    const parsed = await parseRequest(googleDriveUploadContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
          error: getErrorMessage(error, 'Failed to process file'),
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Downloading file from storage`, {
      fileName: userFile.name,
      key: userFile.key,
      size: userFile.size,
    })

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    let fileBuffer: Buffer

    try {
      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } catch (error) {
      logger.error(`[${requestId}] Failed to download file:`, error)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download file: ${getErrorMessage(error, 'Unknown error')}`,
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

    logger.info(`[${requestId}] Uploading to Google Drive via multipart upload`, {
      fileName: validatedData.fileName,
      size: fileBuffer.length,
      uploadMimeType,
      requestedMimeType,
    })

    let finalFile
    try {
      finalFile = await uploadBufferToDrive({
        accessToken: validatedData.accessToken,
        name: validatedData.fileName,
        mimeType: requestedMimeType,
        uploadMimeType,
        buffer: fileBuffer,
        folderId: validatedData.folderId ?? undefined,
      })
    } catch (error) {
      if (error instanceof DriveUploadError) {
        logger.error(`[${requestId}] Google Drive API error:`, {
          status: error.status,
          error: error.message,
        })
        return NextResponse.json({ success: false, error: error.message }, { status: error.status })
      }
      throw error
    }

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
    logger.error(`[${requestId}] Error uploading file to Google Drive:`, error)

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Internal server error'),
      },
      { status: 500 }
    )
  }
})
