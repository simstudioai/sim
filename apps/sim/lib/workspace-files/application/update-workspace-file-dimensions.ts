import type { AuthorizedWorkspaceUseCaseContext } from '@/lib/core/application'
import {
  type ActiveWorkspaceFileContext,
  updateWorkspaceFileDimensions,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

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
