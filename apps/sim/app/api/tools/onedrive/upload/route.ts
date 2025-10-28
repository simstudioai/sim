import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import {
  downloadFileFromStorage,
  processSingleFileToUserFile,
} from '@/lib/uploads/utils/file-processing'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveUploadAPI')

const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const OneDriveUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: z.any(), // UserFile object
  folderId: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized OneDrive upload attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated OneDrive upload request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = OneDriveUploadSchema.parse(body)

    logger.info(`[${requestId}] Uploading file to OneDrive`, {
      fileName: validatedData.fileName,
      folderId: validatedData.folderId || 'root',
    })

    // Handle array or single file
    const rawFile = validatedData.file
    let fileToProcess

    if (Array.isArray(rawFile)) {
      if (rawFile.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'No file provided',
          },
          { status: 400 }
        )
      }
      fileToProcess = rawFile[0]
    } else {
      fileToProcess = rawFile
    }

    // Convert to UserFile format
    let userFile
    try {
      userFile = processSingleFileToUserFile(fileToProcess, requestId, logger)
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process file',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Downloading file from storage: ${userFile.key}`)

    let fileBuffer: Buffer

    try {
      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } catch (error) {
      logger.error(`[${requestId}] Failed to download file from storage:`, error)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 500 }
      )
    }

    const maxSize = 250 * 1024 * 1024 // 250MB
    if (fileBuffer.length > maxSize) {
      const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)
      logger.warn(`[${requestId}] File too large: ${sizeMB}MB`)
      return NextResponse.json(
        {
          success: false,
          error: `File size (${sizeMB}MB) exceeds OneDrive's limit of 250MB for simple uploads. Use chunked upload for larger files.`,
        },
        { status: 400 }
      )
    }

    const fileName = validatedData.fileName || userFile.name

    let uploadUrl: string
    const folderId = validatedData.folderId?.trim()

    if (folderId && folderId !== '') {
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content`
    } else {
      uploadUrl = `${MICROSOFT_GRAPH_BASE}/me/drive/root:/${encodeURIComponent(fileName)}:/content`
    }

    logger.info(`[${requestId}] Uploading to OneDrive: ${uploadUrl}`)

    const mimeType = userFile.type || 'application/octet-stream'

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': mimeType,
      },
      body: new Uint8Array(fileBuffer),
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      logger.error(`[${requestId}] OneDrive upload failed:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: `OneDrive upload failed: ${uploadResponse.statusText}`,
          details: errorText,
        },
        { status: uploadResponse.status }
      )
    }

    const fileData = await uploadResponse.json()

    logger.info(`[${requestId}] File uploaded successfully to OneDrive`, {
      fileId: fileData.id,
      fileName: fileData.name,
      size: fileData.size,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          id: fileData.id,
          name: fileData.name,
          mimeType: fileData.file?.mimeType || mimeType,
          webViewLink: fileData.webUrl,
          webContentLink: fileData['@microsoft.graph.downloadUrl'],
          size: fileData.size,
          createdTime: fileData.createdDateTime,
          modifiedTime: fileData.lastModifiedDateTime,
          parentReference: fileData.parentReference,
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

    logger.error(`[${requestId}] Error uploading file to OneDrive:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
