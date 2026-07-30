import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { dataverseUploadFileContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { getDataverseBaseUrl } from '@/tools/microsoft_dataverse/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('DataverseUploadFileAPI')

/** Dataverse Web API's absolute ceiling for a single-request (non-chunked) file column upload. */
const DATAVERSE_SINGLE_REQUEST_UPLOAD_MAX_BYTES = 128 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Dataverse upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Dataverse upload request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(dataverseUploadFileContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Uploading file to Dataverse`, {
      entitySetName: validatedData.entitySetName,
      recordId: validatedData.recordId,
      fileColumn: validatedData.fileColumn,
      fileName: validatedData.fileName,
      hasFile: !!validatedData.file,
      hasFileContent: !!validatedData.fileContent,
    })

    let fileBuffer: Buffer

    if (validatedData.file) {
      const rawFile = validatedData.file
      logger.info(`[${requestId}] Processing UserFile upload: ${rawFile.name}`)

      let userFile
      try {
        userFile = processSingleFileToUserFile(rawFile, requestId, logger)
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: getErrorMessage(error, 'Failed to process file'),
          },
          { status: 400 }
        )
      }

      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied

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
    } else if (validatedData.fileContent) {
      fileBuffer = Buffer.from(validatedData.fileContent, 'base64')
    } else {
      return NextResponse.json(
        { success: false, error: 'Either file or fileContent must be provided' },
        { status: 400 }
      )
    }

    if (fileBuffer.length > DATAVERSE_SINGLE_REQUEST_UPLOAD_MAX_BYTES) {
      const sizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2)
      logger.warn(`[${requestId}] File too large for single-request upload: ${sizeMB}MB`)
      return NextResponse.json(
        {
          success: false,
          error: `File size (${sizeMB}MB) exceeds Dataverse's 128MB limit for single-request file column uploads. Split the file and use chunked upload instead.`,
        },
        { status: 400 }
      )
    }

    const baseUrl = getDataverseBaseUrl(validatedData.environmentUrl)
    const uploadUrl = `${baseUrl}/api/data/v9.2/${validatedData.entitySetName.trim()}(${validatedData.recordId.trim()})/${validatedData.fileColumn.trim()}`

    const response = await secureFetchWithValidation(
      uploadUrl,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/octet-stream',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          'x-ms-file-name': validatedData.fileName,
        },
        body: fileBuffer,
      },
      'environmentUrl'
    )

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      const errorMessage =
        errorData?.error?.message ??
        `Dataverse API error: ${response.status} ${response.statusText}`
      logger.error(`[${requestId}] Dataverse upload file failed`, {
        errorData,
        status: response.status,
      })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    logger.info(`[${requestId}] File uploaded to Dataverse successfully`, {
      entitySetName: validatedData.entitySetName,
      recordId: validatedData.recordId,
      fileColumn: validatedData.fileColumn,
    })

    return NextResponse.json({
      success: true,
      output: {
        recordId: validatedData.recordId,
        fileColumn: validatedData.fileColumn,
        fileName: validatedData.fileName,
        success: true,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading file to Dataverse:`, error)

    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
