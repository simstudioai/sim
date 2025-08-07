import { writeFile } from 'fs/promises'
import { join } from 'path'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { getPresignedUrl, isUsingCloudStorage, uploadFile } from '@/lib/uploads'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/setup.server'
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

      // Generate storage key based on scoping
      let storageKey: string
      let servePath: string
      if (workflowId && executionId) {
        // Execution-scoped storage: workflow_id/execution_id/filename
        const extension = originalName.split('.').pop() || ''
        const uniqueFilename = `${uuidv4()}.${extension}`
        storageKey = `${workflowId}/${executionId}/${uniqueFilename}`
        servePath = `/api/files/serve/executions/${workflowId}/${executionId}/${uniqueFilename}`
      } else {
        // Default storage: timestamp-filename
        const safeFileName = originalName.replace(/\s+/g, '-')
        storageKey = `${Date.now()}-${safeFileName}`
        servePath = `/api/files/serve/${storageKey}`
      }

      if (usingCloudStorage) {
        // Upload to cloud storage (S3 or Azure Blob) with custom key
        try {
          logger.info(`Uploading file to cloud storage: ${originalName} -> ${storageKey}`)

          // For cloud storage, we need to use a custom approach since the current uploadFile
          // doesn't support custom keys. For now, use the default and update the key in the result
          const result = await uploadFile(buffer, originalName, file.type, file.size)

          // Generate a presigned URL with appropriate expiry
          // Execution files get 5 minutes, other files get 24 hours
          const expirySeconds = workflowId && executionId ? 5 * 60 : 24 * 60 * 60
          let presignedUrl: string | undefined
          try {
            presignedUrl = await getPresignedUrl(result.key, expirySeconds)
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${originalName}:`, error)
          }

          // Create the final result with proper URLs
          // Use the actual key where the file was stored, not our custom storageKey
          const expiryMs = workflowId && executionId ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000
          const customResult = {
            name: originalName,
            size: file.size,
            type: file.type,
            key: result.key, // Use the actual key from cloud storage
            path: servePath, // Keep for backward compatibility
            url: presignedUrl || servePath, // Use presigned URL or fallback to serve path
            uploadedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + expiryMs).toISOString(),
          }

          logger.info(`Successfully uploaded to cloud storage: ${customResult.key}`)
          uploadResults.push(customResult)
        } catch (error) {
          logger.error('Error uploading to cloud storage:', error)
          throw error
        }
      } else {
        // Upload to local file system with execution-scoped path
        const localPath =
          workflowId && executionId
            ? join(UPLOAD_DIR_SERVER, workflowId, executionId)
            : UPLOAD_DIR_SERVER

        // Ensure directory exists
        const { mkdir } = await import('fs/promises')
        await mkdir(localPath, { recursive: true })

        const extension = originalName.split('.').pop() || ''
        const uniqueFilename = `${uuidv4()}.${extension}`
        const filePath = join(localPath, uniqueFilename)

        logger.info(`Uploading file to local storage: ${filePath}`)
        await writeFile(filePath, buffer)
        logger.info(`Successfully wrote file to: ${filePath}`)

        // For local storage, use the serve path
        const expiryMs = workflowId && executionId ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000
        uploadResults.push({
          name: originalName,
          size: file.size,
          type: file.type,
          key: storageKey,
          path: servePath, // Keep for backward compatibility
          url: servePath, // Use clean url field instead of directUrl
          uploadedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + expiryMs).toISOString(),
        })
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
