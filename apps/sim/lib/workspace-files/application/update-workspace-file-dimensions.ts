import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import {
  type ActiveWorkspaceFileContext,
  updateWorkspaceFileDimensions,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface UpdateWorkspaceFileDimensionsInput {
  fileId: string
  assertedWorkspaceId?: string
  key: string
  width: number
  height: number
}

export interface UpdateWorkspaceFileDimensionsResult {
  success: boolean
}

async function executeUpdateWorkspaceFileDimensions({
  input,
  context,
}: AuthorizedWorkspaceUseCaseContext<
  typeof fileOperations.updateMetadata,
  UpdateWorkspaceFileDimensionsInput,
  ActiveWorkspaceFileContext
>): Promise<UpdateWorkspaceFileDimensionsResult> {
  const success = await updateWorkspaceFileDimensions(context.workspaceId, context.fileId, {
    key: input.key,
    width: input.width,
    height: input.height,
  })
  return { success }
}

export const updateWorkspaceFileDimensionsOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateMetadata,
  resolveContext: ({ input }) => resolveActiveWorkspaceFileContext(input),
  execute: executeUpdateWorkspaceFileDimensions,
})
