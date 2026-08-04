import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { UserFile } from '@/executor/types'

/**
 * Execution coordinates as they arrive from a tool request body. All three are
 * required together; a partial context falls back to copilot storage.
 */
export interface ToolOutputExecutionContext {
  workspaceId?: string | null
  workflowId?: string | null
  executionId?: string | null
}

export interface StoreToolOutputFileInput {
  buffer: Buffer
  fileName: string
  contentType: string
  userId: string
  context?: ToolOutputExecutionContext
}

/**
 * Persists a file produced by a tool route. Files created during a workflow run
 * go to the execution store so they expire with the run; everything else goes to
 * the caller's copilot store.
 */
export async function storeToolOutputFile({
  buffer,
  fileName,
  contentType,
  userId,
  context,
}: StoreToolOutputFileInput): Promise<UserFile> {
  const { workspaceId, workflowId, executionId } = context ?? {}
  if (workspaceId && workflowId && executionId) {
    return uploadExecutionFile(
      { workspaceId, workflowId, executionId },
      buffer,
      fileName,
      contentType,
      userId
    )
  }
  return uploadCopilotFile({ buffer, fileName, contentType, userId })
}
