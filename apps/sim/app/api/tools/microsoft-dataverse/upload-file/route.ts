import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('DataverseUploadFileAPI')

const DataverseUploadFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  environmentUrl: z.string().min(1, 'Environment URL is required'),
  entitySetName: z.string().min(1, 'Entity set name is required'),
  recordId: z.string().min(1, 'Record ID is required'),
  fileColumn: z.string().min(1, 'File column is required'),
  fileName: z.string().min(1, 'File name is required'),
  file: RawFileInputSchema.optional().nullable(),
  fileContent: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
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

    const body = await request.json()
    const validatedData = DataverseUploadFileSchema.parse(body)

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

    const response = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'x-ms-file-name': validatedData.fileName,
      },
      body: new Uint8Array(fileBuffer),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
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
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error uploading file to Dataverse:`, error)

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
