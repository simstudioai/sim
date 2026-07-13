import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  type ApiFallbackUploadMetadata,
  uploadViaApiFallbackWithMetadata,
} from '@/lib/uploads/client/api-fallback'
import { DirectUploadError, runUploadStrategy } from '@/lib/uploads/client/direct-upload'

export interface WorkflowAttachmentInput {
  name: string
  size: number
  type: string
  file: File
}

export interface UploadedWorkflowAttachment {
  id: string
  name: string
  url: string
  size: number
  type: string
  key?: string
  context: 'execution'
  uploadedAt?: string
  expiresAt?: string
}

interface UploadWorkflowAttachmentsParams {
  files: WorkflowAttachmentInput[]
  workspaceId: string
  workflowId: string
  executionId: string
}

function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function getDirectUploadFailureReason(error: unknown): string {
  if (error instanceof DirectUploadError && isRecordLike(error.details)) {
    const message =
      getOptionalString(error.details.message) ?? getOptionalString(error.details.error)
    if (message) return message
  }

  return getErrorMessage(error, 'Unknown upload error')
}

function normalizeFallbackUpload(
  value: ApiFallbackUploadMetadata,
  fallbackFile: WorkflowAttachmentInput
): UploadedWorkflowAttachment {
  return {
    id: value.id ?? `file_${Date.now()}_${generateShortId(7)}`,
    name: value.name ?? fallbackFile.name,
    url: value.path,
    size: typeof value.size === 'number' ? value.size : fallbackFile.size,
    type: value.type ?? fallbackFile.type,
    key: value.key,
    context: 'execution',
    uploadedAt: value.uploadedAt,
    expiresAt: value.expiresAt,
  }
}

/**
 * Uploads every explicit workflow attachment before execution may begin.
 *
 * @throws An actionable, file-specific error if any attachment fails.
 */
export async function uploadWorkflowAttachments({
  files,
  workspaceId,
  workflowId,
  executionId,
}: UploadWorkflowAttachmentsParams): Promise<UploadedWorkflowAttachment[]> {
  const uploadedFiles: UploadedWorkflowAttachment[] = []
  const presignedEndpoint = `/api/files/presigned?type=execution&workflowId=${encodeURIComponent(workflowId)}&executionId=${encodeURIComponent(executionId)}&workspaceId=${encodeURIComponent(workspaceId)}`

  for (const fileData of files) {
    try {
      const result = await runUploadStrategy({
        file: fileData.file,
        workspaceId,
        context: 'execution',
        workflowId,
        executionId,
        presignedEndpoint,
      })
      uploadedFiles.push({
        id: `file_${Date.now()}_${generateShortId(7)}`,
        name: fileData.file.name,
        url: result.path,
        size: fileData.file.size,
        type: fileData.file.type,
        key: result.key,
        context: 'execution',
      })
    } catch (uploadError) {
      if (!(uploadError instanceof DirectUploadError) || uploadError.code !== 'FALLBACK_REQUIRED') {
        throw new Error(
          `Failed to upload ${fileData.name}: ${getDirectUploadFailureReason(uploadError)}`
        )
      }

      try {
        const fallbackResult = await uploadViaApiFallbackWithMetadata(fileData.file, 'execution', {
          workflowId,
          executionId,
          workspaceId,
        })
        uploadedFiles.push(normalizeFallbackUpload(fallbackResult, fileData))
      } catch (error) {
        throw new Error(
          `Failed to upload ${fileData.name}: ${getErrorMessage(error, 'Network error')}`
        )
      }
    }
  }

  return uploadedFiles
}
