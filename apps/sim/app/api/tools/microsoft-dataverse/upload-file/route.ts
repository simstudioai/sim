import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { dataverseUploadFileContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

export const dynamic = 'force-dynamic'

const logger = createLogger('DataverseUploadFileAPI')

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
            error: error instanceof Error ? error.message : 'Failed to process file',
          },
          { status: 400 }
        )
      }

      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied

      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } else if (validatedData.fileContent) {
      fileBuffer = Buffer.from(validatedData.fileContent, 'base64')
    } else {
      return NextResponse.json(
        { success: false, error: 'Either file or fileContent must be provided' },
        { status: 400 }
      )
    }

    const baseUrl = validatedData.environmentUrl.replace(/\/$/, '')
    const uploadUrl = `${baseUrl}/api/data/v9.2/${validatedData.entitySetName}(${validatedData.recordId})/${validatedData.fileColumn}`

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
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
})
