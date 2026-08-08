import type { Principal } from '@sim/auth/principal'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileMetadataInput {
  fileId: string
  assertedWorkspaceId?: string
  includeDeleted?: boolean
}

export interface ReadWorkspaceFileMetadataResult {
  file: WorkspaceFileRecord
}

interface ReadWorkspaceFileMetadataArguments {
  principal: Principal
  input: ReadWorkspaceFileMetadataInput
  request?: OrchestrationRequestContext
}

async function executeReadWorkspaceFileMetadata({
  principal,
  input,
}: ReadWorkspaceFileMetadataArguments): Promise<ReadWorkspaceFileMetadataResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.readMetadata,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
    includeDeleted: input.includeDeleted,
  })
  const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
    includeDeleted: input.includeDeleted,
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  return { file }
}

export const readWorkspaceFileMetadata = {
  operation: fileOperations.readMetadata,
  execute: executeReadWorkspaceFileMetadata,
} as const
