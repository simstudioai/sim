import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getPresignedUrl, isUsingCloudStorage, uploadFile } from '@/lib/uploads'
import '@/lib/uploads/setup.server'
import {
  createErrorResponse,
  createOptionsResponse,
  InvalidRequestError,
} from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesUploadAPI')

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Check if multiple files are being uploaded or a single file
    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      throw new InvalidRequestError('No files provided')
    }

    // Get optional scoping parameters for execution-scoped storage
    const workflowId = formData.get('workflowId') as string | null
    const executionId = formData.get('executionId') as string | null
    const workspaceId = formData.get('workspaceId') as string | null

    // Log storage mode
    const usingCloudStorage = isUsingCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

    if (workflowId && executionId) {
      logger.info(
        `Uploading files for execution-scoped storage: workflow=${workflowId}, execution=${executionId}`
      )
    }

    const uploadResults = []

    // Process each file
    for (const file of files) {
      const originalName = file.name
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // For execution-scoped files, use the dedicated execution file storage
      if (workflowId && executionId) {
        // Use the dedicated execution file storage system
        const { uploadExecutionFile } = await import('@/lib/workflows/execution-file-storage')
        const userFile = await uploadExecutionFile(
          {
            workspaceId: workspaceId || '',
            workflowId,
            executionId,
          },
          buffer,
          originalName,
          file.type
        )

        uploadResults.push(userFile)
        continue
      }

      // Upload to cloud or local storage using the standard uploadFile function
      try {
        logger.info(`Uploading file: ${originalName}`)
        const result = await uploadFile(buffer, originalName, file.type, file.size)

        // Generate a presigned URL for cloud storage with appropriate expiry
        // Regular files get 24 hours (execution files are handled above)
        let presignedUrl: string | undefined
        if (usingCloudStorage) {
          try {
            presignedUrl = await getPresignedUrl(result.key, 24 * 60 * 60) // 24 hours
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${originalName}:`, error)
          }
        }

        // Create the serve path
        const servePath = `/api/files/serve/${result.key}`

        const uploadResult = {
          name: originalName,
          size: file.size,
          type: file.type,
          key: result.key,
          path: servePath,
          url: presignedUrl || servePath,
          uploadedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        }

        logger.info(`Successfully uploaded: ${result.key}`)
        uploadResults.push(uploadResult)
      } catch (error) {
        logger.error(`Error uploading ${originalName}:`, error)
        throw error
      }
    }

    // Return all file information
    if (uploadResults.length === 1) {
      return NextResponse.json(uploadResults[0])
    }
    return NextResponse.json({ files: uploadResults })
  } catch (error) {
    logger.error('Error in file upload:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('File upload failed'))
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return createOptionsResponse()
}
