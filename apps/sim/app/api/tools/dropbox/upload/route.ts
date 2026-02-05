import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { httpHeaderSafeJson } from '@/lib/core/utils/validation'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('DropboxUploadAPI')

const DropboxUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  path: z.string().min(1, 'Destination path is required'),
  file: FileInputSchema.optional().nullable(),
  // Legacy field for backwards compatibility
  fileContent: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  mode: z.enum(['add', 'overwrite']).optional().nullable(),
  autorename: z.boolean().optional().nullable(),
  mute: z.boolean().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Dropbox upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Dropbox upload request via ${authResult.authType}`)

    const body = await request.json()
    const validatedData = DropboxUploadSchema.parse(body)

    let fileBuffer: Buffer
    let fileName: string

    // Prefer UserFile input, fall back to legacy base64 string
    if (validatedData.file) {
      // Process UserFile input
      const userFiles = processFilesToUserFiles(
        [validatedData.file as RawFileInput],
        requestId,
        logger
      )

      if (userFiles.length === 0) {
        return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
      }

      const userFile = userFiles[0]
      logger.info(`[${requestId}] Downloading file: ${userFile.name} (${userFile.size} bytes)`)

      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
      fileName = userFile.name
    } else if (validatedData.fileContent) {
      // Legacy: base64 string input (backwards compatibility)
      logger.info(`[${requestId}] Using legacy base64 content input`)
      fileBuffer = Buffer.from(validatedData.fileContent, 'base64')
      fileName = validatedData.fileName || 'file'
    } else {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    // Determine final path
    let finalPath = validatedData.path
    if (finalPath.endsWith('/')) {
      finalPath = `${finalPath}${fileName}`
    }

    logger.info(`[${requestId}] Uploading to Dropbox: ${finalPath} (${fileBuffer.length} bytes)`)

    const dropboxApiArg = {
      path: finalPath,
      mode: validatedData.mode || 'add',
      autorename: validatedData.autorename ?? true,
      mute: validatedData.mute ?? false,
    }

    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': httpHeaderSafeJson(dropboxApiArg),
      },
      body: new Uint8Array(fileBuffer),
    })

    const data = await response.json()

    if (!response.ok) {
      const errorMessage = data.error_summary || data.error?.message || 'Failed to upload file'
      logger.error(`[${requestId}] Dropbox API error:`, { status: response.status, data })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    logger.info(`[${requestId}] File uploaded successfully to ${data.path_display}`)

    return NextResponse.json({
      success: true,
      output: {
        file: data,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Validation error:`, error.errors)
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || 'Validation failed' },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
