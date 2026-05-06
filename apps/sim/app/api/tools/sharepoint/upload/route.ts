import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { sharepointUploadContract } from '@/lib/api/contracts/tools/microsoft'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'
import type { SharepointSkippedFile, SharepointUploadError } from '@/tools/sharepoint/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharepointUploadAPI')
const MAX_SHAREPOINT_UPLOAD_BYTES = 250 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

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

    const parsed = await parseRequest(sharepointUploadContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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

    const siteId = validatedData.siteId.trim() || 'root'
    const driveId = validatedData.driveId?.trim() || null
    const uploadedFiles: MicrosoftGraphDriveItem[] = []
    const skippedFiles: SharepointSkippedFile[] = []
    const errors: SharepointUploadError[] = []

    for (const userFile of userFiles) {
      logger.info(`[${requestId}] Uploading file: ${userFile.name}`)

      const buffer = await downloadFileFromStorage(userFile, requestId, logger)

      const fileName = validatedData.fileName || userFile.name
      const folderPath = validatedData.folderPath?.trim() || ''

      const fileSizeMB = buffer.length / (1024 * 1024)

      if (buffer.length > MAX_SHAREPOINT_UPLOAD_BYTES) {
        logger.warn(
          `[${requestId}] File ${fileName} is ${fileSizeMB.toFixed(2)}MB, exceeds 250MB limit`
        )
        skippedFiles.push({
          name: fileName,
          size: buffer.length,
          limit: MAX_SHAREPOINT_UPLOAD_BYTES,
          reason: 'File exceeds the 250 MB Microsoft Graph small upload limit',
        })
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

      const uploadUrl = driveId
        ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${encodedPath}:/content`
        : `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:${encodedPath}:/content`

      logger.info(`[${requestId}] Uploading to: ${uploadUrl}`)

      const uploadResponse = await secureFetchWithValidation(
        uploadUrl,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${validatedData.accessToken}`,
            'Content-Type': userFile.type || 'application/octet-stream',
          },
          body: buffer,
        },
        'uploadUrl'
      )

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}))
        logger.error(`[${requestId}] Failed to upload file ${fileName}:`, errorData)

        if (uploadResponse.status === 409) {
          // File exists - retry with conflict behavior set to replace
          logger.warn(`[${requestId}] File ${fileName} already exists, retrying with replace`)
          const replaceUrl = `${uploadUrl}?@microsoft.graph.conflictBehavior=replace`
          const replaceResponse = await secureFetchWithValidation(
            replaceUrl,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${validatedData.accessToken}`,
                'Content-Type': userFile.type || 'application/octet-stream',
              },
              body: buffer,
            },
            'replaceUrl'
          )

          if (!replaceResponse.ok) {
            const replaceErrorData = (await replaceResponse.json().catch(() => ({}))) as {
              error?: { message?: string }
            }
            logger.error(`[${requestId}] Failed to replace file ${fileName}:`, replaceErrorData)
            errors.push({
              name: fileName,
              status: replaceResponse.status,
              error: replaceErrorData.error?.message || `Failed to replace file: ${fileName}`,
            })
            continue
          }

          const replaceData = (await replaceResponse.json()) as {
            id: string
            name: string
            webUrl: string
            size: number
            createdDateTime: string
            lastModifiedDateTime: string
          }
          logger.info(`[${requestId}] File replaced successfully: ${fileName}`)

          uploadedFiles.push({
            id: replaceData.id,
            name: replaceData.name,
            webUrl: replaceData.webUrl,
            size: replaceData.size,
            createdDateTime: replaceData.createdDateTime,
            lastModifiedDateTime: replaceData.lastModifiedDateTime,
          })
          continue
        }

        errors.push({
          name: fileName,
          status: uploadResponse.status,
          error:
            (errorData as { error?: { message?: string } }).error?.message ||
            `Failed to upload file: ${fileName}`,
        })
        continue
      }

      const uploadData = (await uploadResponse.json()) as MicrosoftGraphDriveItem
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
      return NextResponse.json({
        success: false,
        error: 'No files were uploaded successfully',
        output: {
          uploadedFiles,
          fileCount: 0,
          skippedFiles,
          skippedCount: skippedFiles.length,
          errors,
        },
      })
    }

    logger.info(`[${requestId}] Completed SharePoint upload`, {
      uploadedCount: uploadedFiles.length,
      skippedCount: skippedFiles.length,
      errorCount: errors.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        uploadedFiles,
        fileCount: uploadedFiles.length,
        skippedFiles,
        skippedCount: skippedFiles.length,
        errors,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading files to SharePoint:`, error)
    return NextResponse.json(
      {
        success: false,
        error: toError(error).message,
      },
      { status: 500 }
    )
  }
})
