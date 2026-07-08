import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { daytonaUploadFileContract } from '@/lib/api/contracts/tools/daytona'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { DAYTONA_TOOLBOX_BASE_URL, extractDaytonaError } from '@/tools/daytona/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('DaytonaUploadAPI')

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Daytona upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Daytona upload request via ${authResult.authType}`)

    const parsed = await parseRequest(daytonaUploadFileContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    let fileBuffer: Buffer
    let fileName: string

    if (params.file) {
      const userFiles = processFilesToUserFiles([params.file as RawFileInput], requestId, logger)

      if (userFiles.length === 0) {
        return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
      }

      const userFile = userFiles[0]
      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied

      if (userFile.size > MAX_UPLOAD_SIZE_BYTES) {
        const sizeMB = (userFile.size / (1024 * 1024)).toFixed(2)
        return NextResponse.json(
          { success: false, error: `File size (${sizeMB}MB) exceeds upload limit of 100MB` },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Downloading file: ${userFile.name} (${userFile.size} bytes)`)
      try {
        const servable = await downloadServableFileFromStorage(userFile, requestId, logger)
        fileBuffer = servable.buffer
      } catch (error) {
        const notReady = docNotReadyResponse(error)
        if (notReady) return notReady
        logger.error(`[${requestId}] Failed to download file from storage:`, error)
        return NextResponse.json(
          { success: false, error: getErrorMessage(error, 'Failed to download file') },
          { status: 500 }
        )
      }
      fileName = params.fileName || userFile.name
    } else if (params.fileContent) {
      logger.info(`[${requestId}] Using legacy base64 content input`)
      const estimatedSize = Math.floor((params.fileContent.length * 3) / 4)
      if (estimatedSize > MAX_UPLOAD_SIZE_BYTES) {
        const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2)
        return NextResponse.json(
          { success: false, error: `File size (${sizeMB}MB) exceeds upload limit of 100MB` },
          { status: 400 }
        )
      }
      fileBuffer = Buffer.from(params.fileContent, 'base64')
      fileName = params.fileName || 'file'
    } else {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    if (fileBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
      const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)
      return NextResponse.json(
        { success: false, error: `File size (${sizeMB}MB) exceeds upload limit of 100MB` },
        { status: 400 }
      )
    }

    const requestedPath = params.destinationPath.trim()
    if (!requestedPath) {
      return NextResponse.json(
        { success: false, error: 'Destination path is required' },
        { status: 400 }
      )
    }
    const destinationPath = requestedPath.endsWith('/')
      ? `${requestedPath}${fileName}`
      : requestedPath

    logger.info(
      `[${requestId}] Uploading to Daytona sandbox ${params.sandboxId}: ${destinationPath} (${fileBuffer.length} bytes)`
    )

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([new Uint8Array(fileBuffer)], { type: 'application/octet-stream' }),
      fileName
    )

    const uploadUrl = `${DAYTONA_TOOLBOX_BASE_URL}/${encodeURIComponent(params.sandboxId.trim())}/files/upload?path=${encodeURIComponent(destinationPath)}`
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorMessage = await extractDaytonaError(response, 'Failed to upload file')
      logger.error(`[${requestId}] Daytona API error:`, { status: response.status, errorMessage })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    logger.info(`[${requestId}] File uploaded successfully: ${destinationPath}`)

    return NextResponse.json({
      success: true,
      uploadedPath: destinationPath,
      name: fileName,
      size: fileBuffer.length,
    })
  } catch (error) {
    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
