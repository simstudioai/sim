import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadActiveWorkspaceContext,
  resolveWorkspaceFileReference as resolveStoredWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import {
  fileOperations,
  type WorkspaceOperation,
} from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

export interface ResolveWorkspaceFileReferenceInput {
  principal: Principal
  operation: WorkspaceOperation
  workspaceId: string
  reference: string
}

/** Resolve one workspace-file reference under an explicit semantic operation policy. */
export async function resolveWorkspaceFileReference({
  principal,
  operation,
  workspaceId,
  reference,
}: ResolveWorkspaceFileReferenceInput): Promise<WorkspaceFileRecord> {
  const workspace = await loadActiveWorkspaceContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
  await authorizeWorkspaceOperation(principal, operation, workspace)

  const file = await resolveStoredWorkspaceFileReference(workspaceId, reference)
  if (!file) throw new OrchestrationError('not_found', 'File not found')

  await loadAuthorizedWorkspaceFile({
    principal,
    operation,
    fileId: file.id,
    assertedWorkspaceId: workspaceId,
  })

  return file
}

export interface ReadWorkspaceFileReferenceInput
  extends Omit<ResolveWorkspaceFileReferenceInput, 'operation'> {
  maxBytes: number
}

/** Resolve one trusted workspace-file reference and read it under the shared file policy. */
export async function readWorkspaceFileReference({
  principal,
  workspaceId,
  reference,
  maxBytes,
}: ReadWorkspaceFileReferenceInput): Promise<{ file: WorkspaceFileRecord; content: Buffer }> {
  const file = await resolveWorkspaceFileReference({
    principal,
    operation: fileOperations.readContent,
    workspaceId,
    reference,
  })
  return readWorkspaceFileContent.execute({
    principal,
    input: { fileId: file.id, assertedWorkspaceId: workspaceId, maxBytes },
  })
}
