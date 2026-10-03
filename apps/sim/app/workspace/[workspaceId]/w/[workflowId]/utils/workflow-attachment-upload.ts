import { getErrorMessage } from '@sim/utils/errors'
import { uploadInternalFileSession } from '@/lib/uploads/client/session-upload'

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

  for (const fileData of files) {
    try {
      const result = await uploadInternalFileSession({
        purpose: 'execution_attachment',
        file: fileData.file,
        workspaceId,
        workflowId,
        executionId,
      })
      uploadedFiles.push(result)
    } catch (uploadError) {
      throw new Error(
        `Failed to upload ${fileData.name}: ${getErrorMessage(uploadError, 'Network error')}`
      )
    }
  }

  return uploadedFiles
}
