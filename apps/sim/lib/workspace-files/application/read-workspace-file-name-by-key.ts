import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { isWorkspaceScopedContext } from '@/lib/uploads/shared/types'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export interface ReadWorkspaceFileNameByKeyInput {
  workspaceId: string
  key: string
}

export const readWorkspaceFileNameByKey = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readMetadata,
  async resolveContext({ input }: { input: ReadWorkspaceFileNameByKeyInput }) {
    const workspace = await loadActiveWorkspaceContext(input.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return workspace
  },
  async execute({ input, context }): Promise<{ name: string | null }> {
    const metadata = await getFileMetadataByKey(input.key)
    if (
      !metadata ||
      metadata.workspaceId !== context.workspaceId ||
      !isWorkspaceScopedContext(metadata.context)
    ) {
      return { name: null }
    }
    return { name: metadata.originalName }
  },
})
