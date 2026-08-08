import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { updateWorkspaceFileDimensions } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
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
  principal,
  input,
}: {
  principal: Principal
  input: UpdateWorkspaceFileDimensionsInput
  request?: OrchestrationRequestContext
}): Promise<UpdateWorkspaceFileDimensionsResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.updateMetadata,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  const success = await updateWorkspaceFileDimensions(canonical.workspaceId, canonical.fileId, {
    key: input.key,
    width: input.width,
    height: input.height,
  })
  return { success }
}

export const updateWorkspaceFileDimensionsOperation = {
  operation: fileOperations.updateMetadata,
  execute: executeUpdateWorkspaceFileDimensions,
} as const
