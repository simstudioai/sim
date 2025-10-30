import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharepointUploadAPI')

const SharepointUploadSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  siteId: z.string().default('root'),
  driveId: z.string().optional().nullable(),
  folderPath: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  files: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SharePoint upload attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated SharePoint upload request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const body = await request.json()
    const validatedData = SharepointUploadSchema.parse(body)

    logger.info(`[${requestId}] Uploading files to SharePoint`, {
      siteId: validatedData.siteId,
      driveId: validatedData.driveId,
      folderPath: validatedData.folderPath,
      hasFiles: !!(validatedData.files && validatedData.files.length > 0),
      fileCount: validatedData.files?.length || 0,
    })

    if (!validatedData.files || validatedData.files.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one file is required for upload',
        },
        { status: 400 }
      )
    }

    const userFiles = processFilesToUserFiles(validatedData.files, requestId, logger)

    if (userFiles.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid files to upload',
        },
        { status: 400 }
      )
    }

    let effectiveDriveId = validatedData.driveId
    if (!effectiveDriveId) {
      logger.info(`[${requestId}] No driveId provided, fetching default drive for site`)
      const driveResponse = await fetch(
        `https://graph.microsoft.com/v1.0/sites/${validatedData.siteId}/drive`,
        {
          headers: {
            Authorization: `Bearer ${validatedData.accessToken}`,
            Accept: 'application/json',
          },
        }
      )

      if (!driveResponse.ok) {
        const errorData = await driveResponse.json().catch(() => ({}))
        logger.error(`[${requestId}] Failed to get default drive:`, errorData)
        return NextResponse.json(
          {
            success: false,
            error: errorData.error?.message || 'Failed to get default document library',
          },
          { status: driveResponse.status }
        )
      }

      const driveData = await driveResponse.json()
      effectiveDriveId = driveData.id
      logger.info(`[${requestId}] Using default drive: ${effectiveDriveId}`)
    }

    const uploadedFiles: any[] = []

    for (const userFile of userFiles) {
      logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const fileName = validatedData.fileName || userFile.name
      const folderPath = validatedData.folderPath?.trim() || ''

      const fileSizeMB = buffer.length / (1024 * 1024)

      if (fileSizeMB > 250) {
        logger.warn(
          `[${requestId}] File ${fileName} is ${fileSizeMB.toFixed(2)}MB, exceeds 250MB limit`
        )
        continue
      }

      let uploadPath = ''
      if (folderPath) {
        const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
        const cleanPath = normalizedPath.endsWith('/')
          ? normalizedPath.slice(0, -1)
          : normalizedPath
        uploadPath = `${cleanPath}/${fileName}`
      } else {
        uploadPath = `/${fileName}`
      }

      const encodedPath = uploadPath
        .split('/')
        .map((segment) => (segment ? encodeURIComponent(segment) : ''))
        .join('/')

      const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${validatedData.siteId}/drives/${effectiveDriveId}/root:${encodedPath}:/content`

      logger.info(`[${requestId}] Uploading to: ${uploadUrl}`)

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': userFile.type || 'application/octet-stream',
        },
        body: new Uint8Array(buffer),
      })

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}))
        logger.error(`[${requestId}] Failed to upload file ${fileName}:`, errorData)

        if (uploadResponse.status === 409) {
          logger.warn(`[${requestId}] File ${fileName} already exists, attempting to replace`)
          continue
        }

        return NextResponse.json(
          {
            success: false,
            error: errorData.error?.message || `Failed to upload file: ${fileName}`,
          },
          { status: uploadResponse.status }
        )
      }

      const uploadData = await uploadResponse.json()
      logger.info(`[${requestId}] File uploaded successfully: ${fileName}`)

      uploadedFiles.push({
        id: uploadData.id,
        name: uploadData.name,
        webUrl: uploadData.webUrl,
        size: uploadData.size,
        createdDateTime: uploadData.createdDateTime,
        lastModifiedDateTime: uploadData.lastModifiedDateTime,
      })
    }

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No files were uploaded successfully',
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Successfully uploaded ${uploadedFiles.length} file(s)`)

    return NextResponse.json({
      success: true,
      output: {
        uploadedFiles,
        fileCount: uploadedFiles.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading files to SharePoint:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
