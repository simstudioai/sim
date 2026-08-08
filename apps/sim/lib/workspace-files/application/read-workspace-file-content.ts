import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import {
  fileOperations,
  type WorkspaceOperation,
} from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileContentInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Optional post-authorization storage ceiling for bounded binary reads. */
  maxBytes?: number
  includeDeleted?: boolean
}

export interface ReadWorkspaceFileContentResult {
  file: WorkspaceFileRecord
  content: Buffer
}

function executeReadWorkspaceFileContent(operation: WorkspaceOperation) {
  return async ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkspaceFileContentInput
  }): Promise<ReadWorkspaceFileContentResult> => {
    const canonical = await loadAuthorizedWorkspaceFile({
      principal,
      operation,
      fileId: input.fileId,
      assertedWorkspaceId: input.assertedWorkspaceId,
      includeDeleted: input.includeDeleted,
    })
    const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
      includeDeleted: input.includeDeleted,
      throwOnError: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return {
      file,
      content: await fetchWorkspaceFileBuffer(file, { maxBytes: input.maxBytes }),
    }
  }
}

export const readWorkspaceFileContent = {
  operation: fileOperations.readContent,
  execute: executeReadWorkspaceFileContent(fileOperations.readContent),
} as const
