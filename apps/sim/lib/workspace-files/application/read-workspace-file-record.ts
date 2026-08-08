import type { Principal } from '@sim/auth/principal'
import type { WorkspaceOperation } from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileRecordInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface ReadWorkspaceFileRecordResult {
  file: WorkspaceFileRecord
}

function executeReadWorkspaceFileRecord(operation: WorkspaceOperation) {
  return async ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkspaceFileRecordInput
    request?: OrchestrationRequestContext
  }): Promise<ReadWorkspaceFileRecordResult> => {
    const canonical = await loadAuthorizedWorkspaceFile({
      principal,
      operation,
      fileId: input.fileId,
      assertedWorkspaceId: input.assertedWorkspaceId,
    })
    const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
      throwOnError: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return { file }
  }
}

export const readWorkspaceFileContentRecord = {
  operation: fileOperations.readContent,
  execute: executeReadWorkspaceFileRecord(fileOperations.readContent),
} as const

export const downloadWorkspaceFileRecord = {
  operation: fileOperations.download,
  execute: executeReadWorkspaceFileRecord(fileOperations.download),
} as const
