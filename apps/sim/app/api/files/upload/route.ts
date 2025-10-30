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
    const contextParam = formData.get('context') as string | null

    // Determine context: explicit > workspace > execution > general
    const context: StorageContext =
      (contextParam as StorageContext) ||
      (workspaceId ? 'workspace' : workflowId && executionId ? 'execution' : 'general')

    const storageService = await import('@/lib/uploads/core/storage-service')
    const usingCloudStorage = storageService.hasCloudStorage()
    logger.info(`Using storage mode: ${usingCloudStorage ? 'Cloud' : 'Local'} for file upload`)

    if (workflowId && executionId) {
      logger.info(
        `Uploading files for execution-scoped storage: workflow=${workflowId}, execution=${executionId}`
      )
    } else if (workspaceId) {
      logger.info(`Uploading files for workspace-scoped storage: workspace=${workspaceId}`)
    } else if (contextParam) {
      logger.info(`Uploading files for ${contextParam} context`)
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

      // Priority 1: Execution-scoped storage (temporary, 5 min expiry)
      if (workflowId && executionId) {
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
          session.user.id // userId available from session
        )

        uploadResults.push(userFile)
        continue
      }

      // Priority 2: Knowledge-base files (must check BEFORE workspace to avoid duplicate file check)
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
          fileName: originalName,
          contentType: file.type,
          context: 'knowledge-base',
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

      // Priority 3: Workspace-scoped storage (persistent, no expiry)
      // Only if context is NOT explicitly set to something else
      if (workspaceId && !contextParam) {
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

      // Priority 4: Context-specific uploads (copilot, chat, profile-pictures)
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
          fileName: originalName,
          contentType: file.type,
          context,
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

      // Priority 5: General uploads (fallback)
      try {
        logger.info(`Uploading file (general context): ${originalName}`)

        const metadata: Record<string, string> = {
          originalName: originalName,
          uploadedAt: new Date().toISOString(),
          purpose: 'general',
          userId: session.user.id,
        }

        if (workspaceId) {
          metadata.workspaceId = workspaceId
        }

        const fileInfo = await storageService.uploadFile({
          file: buffer,
          fileName: originalName,
          contentType: file.type,
          context: 'general',
          metadata,
        })

        let downloadUrl: string | undefined
        if (storageService.hasCloudStorage()) {
          try {
            downloadUrl = await storageService.generatePresignedDownloadUrl(
              fileInfo.key,
              'general',
              24 * 60 * 60 // 24 hours
            )
          } catch (error) {
            logger.warn(`Failed to generate presigned URL for ${originalName}:`, error)
          }
        }

        const uploadResult = {
          name: originalName,
          size: buffer.length,
          type: file.type,
          key: fileInfo.key,
          path: fileInfo.path,
          url: downloadUrl || fileInfo.path,
          uploadedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
          context: 'general',
        }

        logger.info(`Successfully uploaded: ${fileInfo.key}`)
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
