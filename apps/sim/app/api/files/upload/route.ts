import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getPresignedUrl, isUsingCloudStorage, uploadFile } from '@/lib/uploads'
import '@/lib/uploads/setup.server'
import { getSession } from '@/lib/auth'
import {
  createErrorResponse,
  createOptionsResponse,
  InvalidRequestError,
} from '@/app/api/files/utils'

const ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'txt',
  'md',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'csv',
  'xlsx',
  'xls',
  'json',
  'yaml',
  'yml',
])

/**
 * Validates file extension against allowlist
 */
function validateFileExtension(filename: string): boolean {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) return false
  return ALLOWED_EXTENSIONS.has(extension)
}

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesUploadAPI')

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()

    const files = formData.getAll('file') as File[]

    if (!files || files.length === 0) {
      throw new InvalidRequestError('No files provided')
    }

    const workflowId = formData.get('workflowId') as string | null
    const executionId = formData.get('executionId') as string | null
    const workspaceId = formData.get('workspaceId') as string | null

    const usingCloudStorage = isUsingCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

    if (workflowId && executionId) {
      logger.info(
        `Uploading files for execution-scoped storage: workflow=${workflowId}, execution=${executionId}`
      )
    }

    const uploadResults = []

    for (const file of files) {
      const originalName = file.name

      if (!validateFileExtension(originalName)) {
        const extension = originalName.split('.').pop()?.toLowerCase() || 'unknown'
        throw new InvalidRequestError(
          `File type '${extension}' is not allowed. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`
        )
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      if (workflowId && executionId) {
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

      try {
        logger.info(`Uploading file: ${originalName}`)
        const result = await uploadFile(buffer, originalName, file.type, file.size)

        let presignedUrl: string | undefined
        if (usingCloudStorage) {
          try {
            presignedUrl = await getPresignedUrl(result.key, 24 * 60 * 60) // 24 hours
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${originalName}:`, error)
          }
        }

        const servePath = result.path

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

    if (uploadResults.length === 1) {
      return NextResponse.json(uploadResults[0])
    }
    return NextResponse.json({ files: uploadResults })
  } catch (error) {
    logger.error('Error in file upload:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('File upload failed'))
  }
}

export async function OPTIONS() {
  return createOptionsResponse()
}
