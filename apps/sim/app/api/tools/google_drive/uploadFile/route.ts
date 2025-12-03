import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { GOOGLE_WORKSPACE_MIME_TYPES, SOURCE_MIME_TYPES } from '@/tools/google_drive/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveUploadFileAPI')

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/upload/drive/v3/files'
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const GoogleDriveUploadFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: z
    .object({
      content: z.string().min(1, 'File content is required'),
      name: z.string().optional(),
      fileType: z.string().optional(),
      mimetype: z.string().optional(),
    })
    .optional()
    .nullable(),
  mimeType: z.string().optional().nullable(),
  folderId: z.string().optional().nullable(),
  folderSelector: z.string().optional().nullable(),
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
      logger.warn(
        `[${requestId}] Unauthorized Google Drive upload file attempt: ${authResult.error}`
      )
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Google Drive upload file request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = GoogleDriveUploadFileSchema.parse(body)

    logger.info(`[${requestId}] Uploading file to Google Drive`, {
      fileName: validatedData.fileName,
      mimeType: validatedData.mimeType,
      folderId: validatedData.folderId || validatedData.folderSelector,
      hasFile: !!validatedData.file,
    })

    if (!validatedData.file || !validatedData.file.content) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file content provided. File must have a content property with base64 data.',
        },
        { status: 400 }
      )
    }

    // Process file content - handle base64/base64url format
    let fileBuffer: Buffer
    const fileData = validatedData.file

    try {
      let base64Data = fileData.content

      // Convert base64url to base64 if needed (presentation tool may use base64url)
      if (base64Data && (base64Data.includes('-') || base64Data.includes('_'))) {
        base64Data = base64Data.replace(/-/g, '+').replace(/_/g, '/')
        logger.info(`[${requestId}] Converted base64url to base64`)
      }

      fileBuffer = Buffer.from(base64Data, 'base64')

      if (fileBuffer.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'File content is empty after decoding',
          },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Decoded file content`, {
        size: fileBuffer.length,
        fileName: fileData.name || validatedData.fileName,
      })
    } catch (error) {
      logger.error(`[${requestId}] Failed to decode file content:`, error)
      return NextResponse.json(
        {
          success: false,
          error: `Failed to decode file content: ${error instanceof Error ? error.message : 'Invalid base64 data'}`,
        },
        { status: 400 }
      )
    }

    // Determine MIME type - prioritize provided mimeType, then file metadata, default to PPTX
    const requestedMimeType =
      validatedData.mimeType || fileData.fileType || fileData.mimetype || PPTX_MIME_TYPE

    // For PPTX files, we don't need to convert MIME types (not a Google Workspace format)
    // But we still check if it's a Google Workspace type for consistency
    let uploadMimeType = requestedMimeType
    if (GOOGLE_WORKSPACE_MIME_TYPES.includes(requestedMimeType)) {
      uploadMimeType = SOURCE_MIME_TYPES[requestedMimeType] || 'text/plain'
      logger.info(`[${requestId}] Converting to Google Workspace source type`, {
        requestedMimeType,
        uploadMimeType,
      })
    }

    // Use file name from file object if available, otherwise use provided fileName
    const finalFileName = fileData.name || validatedData.fileName

    // Use folderSelector if provided, otherwise use folderId
    const parentFolderId = (validatedData.folderSelector || validatedData.folderId || '').trim()

    const metadata: {
      name: string
      mimeType: string
      parents?: string[]
    } = {
      name: finalFileName,
      mimeType: requestedMimeType, // Use requested MIME type for metadata (Google Drive will handle conversion)
    }

    if (parentFolderId) {
      metadata.parents = [parentFolderId]
    }

    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const multipartBody = buildMultipartBody(metadata, fileBuffer, uploadMimeType, boundary)

    logger.info(`[${requestId}] Uploading PPTX file to Google Drive via multipart upload`, {
      fileName: finalFileName,
      size: fileBuffer.length,
      uploadMimeType,
      requestedMimeType,
      hasParent: !!parentFolderId,
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

    // For Google Workspace documents, update the name again to ensure it sticks after conversion
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
            name: finalFileName,
          }),
        }
      )

      if (!updateNameResponse.ok) {
        logger.warn(
          `[${requestId}] Failed to update filename after conversion, but content was uploaded`
        )
      }
    }

    // Get the final file data with all metadata
    const finalFileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,webContentLink,size,createdTime,modifiedTime,parents`,
      {
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
        },
      }
    )

    if (!finalFileResponse.ok) {
      const errorData = await finalFileResponse.json()
      logger.error(`[${requestId}] Failed to get final file data`, {
        status: finalFileResponse.status,
        error: errorData,
      })
      return NextResponse.json(errorData, { status: finalFileResponse.status })
    }

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
