import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import '@/lib/uploads/core/setup.server'
import { getSession } from '@/lib/auth'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import type { StorageContext } from '@/lib/uploads/config'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import { validateFileType } from '@/lib/uploads/utils/validation'
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
    const contextParam = formData.get('context') as string | null

    // Context must be explicitly provided
    if (!contextParam) {
      throw new InvalidRequestError(
        'Upload requires explicit context parameter (knowledge-base, workspace, execution, copilot, chat, or profile-pictures)'
      )
    }

    const context = contextParam as StorageContext

    const storageService = await import('@/lib/uploads/core/storage-service')
    const usingCloudStorage = storageService.hasCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

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

      // Handle execution context
      if (context === 'execution') {
        if (!workflowId || !executionId) {
          throw new InvalidRequestError(
            'Execution context requires workflowId and executionId parameters'
          )
        }

        const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')
        const userFile = await uploadExecutionFile(
          {
            workspaceId: workspaceId || '',
            workflowId,
            executionId,
          },
          buffer,
          originalName,
          file.type,
          session.user.id
        )

        uploadResults.push(userFile)
        continue
      }

      // Handle knowledge-base context
      if (context === 'knowledge-base') {
        // Validate file type for knowledge base
        const validationError = validateFileType(originalName, file.type)
        if (validationError) {
          throw new InvalidRequestError(validationError.message)
        }

        if (workspaceId) {
          const permission = await getUserEntityPermissions(
            session.user.id,
            'workspace',
            workspaceId
          )
          if (permission === null) {
            return NextResponse.json(
              { error: 'Insufficient permissions for workspace' },
              { status: 403 }
            )
          }
        }

        logger.info(`Uploading knowledge-base file: ${originalName}`)

        const timestamp = Date.now()
        const safeFileName = originalName.replace(/\s+/g, '-')
        const storageKey = `kb/${timestamp}-${safeFileName}`

        const metadata: Record<string, string> = {
          originalName: originalName,
          uploadedAt: new Date().toISOString(),
          purpose: 'knowledge-base',
          userId: session.user.id,
        }

        if (workspaceId) {
          metadata.workspaceId = workspaceId
        }

        const fileInfo = await storageService.uploadFile({
          file: buffer,
          fileName: storageKey,
          contentType: file.type,
          context: 'knowledge-base',
          preserveKey: true,
          customKey: storageKey,
          metadata,
        })

        const finalPath = usingCloudStorage
          ? `${fileInfo.path}?context=knowledge-base`
          : fileInfo.path

        const uploadResult = {
          fileName: originalName,
          presignedUrl: '', // Not used for server-side uploads
          fileInfo: {
            path: finalPath,
            key: fileInfo.key,
            name: originalName,
            size: buffer.length,
            type: file.type,
          },
          directUploadSupported: false,
        }

        logger.info(`Successfully uploaded knowledge-base file: ${fileInfo.key}`)
        uploadResults.push(uploadResult)
        continue
      }

      // Handle workspace context
      if (context === 'workspace') {
        if (!workspaceId) {
          throw new InvalidRequestError('Workspace context requires workspaceId parameter')
        }

        try {
          const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace')
          const userFile = await uploadWorkspaceFile(
            workspaceId,
            session.user.id,
            buffer,
            originalName,
            file.type || 'application/octet-stream'
          )

          uploadResults.push(userFile)
          continue
        } catch (workspaceError) {
          const errorMessage =
            workspaceError instanceof Error ? workspaceError.message : 'Upload failed'
          const isDuplicate = errorMessage.includes('already exists')
          const isStorageLimitError =
            errorMessage.includes('Storage limit exceeded') ||
            errorMessage.includes('storage limit')

          logger.warn(`Workspace file upload failed: ${errorMessage}`)

          let statusCode = 500
          if (isDuplicate) statusCode = 409
          else if (isStorageLimitError) statusCode = 413

          return NextResponse.json(
            {
              success: false,
              error: errorMessage,
              isDuplicate,
            },
            { status: statusCode }
          )
        }
      }

      // Handle image-only contexts (copilot, chat, profile-pictures)
      if (context === 'copilot' || context === 'chat' || context === 'profile-pictures') {
        if (!isImageFileType(file.type)) {
          throw new InvalidRequestError(
            `Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for ${context} uploads`
          )
        }

        if (context === 'chat' && workspaceId) {
          const permission = await getUserEntityPermissions(
            session.user.id,
            'workspace',
            workspaceId
          )
          if (permission === null) {
            return NextResponse.json(
              { error: 'Insufficient permissions for workspace' },
              { status: 403 }
            )
          }
        }

        logger.info(`Uploading ${context} file: ${originalName}`)

        // Generate storage key with context prefix and timestamp to ensure uniqueness
        const timestamp = Date.now()
        const safeFileName = originalName.replace(/\s+/g, '-')
        const storageKey = `${context}/${timestamp}-${safeFileName}`

        const metadata: Record<string, string> = {
          originalName: originalName,
          uploadedAt: new Date().toISOString(),
          purpose: context,
          userId: session.user.id,
        }

        if (workspaceId && context === 'chat') {
          metadata.workspaceId = workspaceId
        }

        const fileInfo = await storageService.uploadFile({
          file: buffer,
          fileName: storageKey,
          contentType: file.type,
          context,
          preserveKey: true,
          customKey: storageKey,
          metadata,
        })

        const finalPath = usingCloudStorage ? `${fileInfo.path}?context=${context}` : fileInfo.path

        const uploadResult = {
          fileName: originalName,
          presignedUrl: '', // Not used for server-side uploads
          fileInfo: {
            path: finalPath,
            key: fileInfo.key,
            name: originalName,
            size: buffer.length,
            type: file.type,
          },
          directUploadSupported: false,
        }

        logger.info(`Successfully uploaded ${context} file: ${fileInfo.key}`)
        uploadResults.push(uploadResult)
        continue
      }

      // Unknown context
      throw new InvalidRequestError(
        `Unsupported context: ${context}. Use knowledge-base, workspace, execution, copilot, chat, or profile-pictures`
      )
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
