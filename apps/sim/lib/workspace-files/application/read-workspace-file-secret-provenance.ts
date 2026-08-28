import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'

export interface ReadWorkspaceFileSecretProvenanceInput {
  fileId: string
  assertedWorkspaceId?: string
}

export const readWorkspaceFileSecretProvenance = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readContent,
  resolveContext: ({ input }: { input: ReadWorkspaceFileSecretProvenanceInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ input, context }): Promise<{
    provenance: WorkspaceFileSecretProvenance
    ownerUserId: string
  }> {
    const file = await getWorkspaceFile(context.workspaceId, context.fileId, { throwOnError: true })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return {
      provenance: await getBoundWorkspaceFileSecretProvenance(context.workspaceId, {
        fileId: file.id,
        key: file.key,
        context: 'workspace',
      }),
      ownerUserId: file.uploadedBy,
    }
  },
})
