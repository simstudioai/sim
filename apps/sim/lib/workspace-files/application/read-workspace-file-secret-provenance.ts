import type { Principal } from '@sim/auth/principal'
import { admitContent } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { workspaceFileProvenanceIdentity } from '@/lib/workspace-files/application/admit-file-content'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileSecretProvenanceInput {
  fileId: string
  assertedWorkspaceId?: string
  /** Fails closed when the caller's derived content no longer matches the canonical file revision. */
  expectedContentUpdatedAt?: Date
}

export const readWorkspaceFileSecretProvenance = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadWorkspaceFileSecretProvenanceInput
  }) => resolveActiveWorkspaceFileContext({ ...input, ownedFilePrincipal: principal }),
  async execute({ input, context, principal }): Promise<{
    provenance: WorkspaceFileSecretProvenance
    ownerUserId: string
  }> {
    const file = await getWorkspaceFile(context.workspaceId, context.fileId, {
      throwOnError: true,
      includeOwnedFiles: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    /** A classification names secrets by ciphertext only and returns none of the file's content. */
    await admitContent(principal, [])
    return {
      provenance: await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
        ...workspaceFileProvenanceIdentity(file),
        contentUpdatedAt: input.expectedContentUpdatedAt,
      }),
      ownerUserId: file.uploadedBy,
    }
  },
})
