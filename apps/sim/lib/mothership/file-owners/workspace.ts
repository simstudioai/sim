import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeCopilotFileUseCase } from '@/lib/mothership/application/execute-file-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import type { CopilotFileOwnerAdapter } from '@/lib/mothership/file-owners/types'
import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { fileOwnerVfsPath } from '@/lib/workspace-files/owner-paths'

export const workspaceFileOwnerAdapter: CopilotFileOwnerAdapter = {
  resourceScope: 'workspace',
  async readChatMetadata(ingress, target) {
    if (ingress.workspaceId !== target.owner.entityId) {
      throw new OrchestrationError('not_found', 'File owner not found in this invocation')
    }
    const principal = createCopilotChatFilePrincipal({
      userId: ingress.userId,
      workspaceId: target.owner.entityId,
      chatId: ingress.chatId,
    })
    const { file } = await readWorkspaceFileMetadata.execute({
      principal,
      input: { fileId: target.fileId, assertedWorkspaceId: target.owner.entityId },
    })
    return {
      id: file.id,
      name: file.name,
      owner: { entityType: 'workspace', entityId: target.owner.entityId },
      path: fileOwnerVfsPath(
        target.owner,
        canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name })
      ),
    }
  },
  async executeCli(request, context, owner) {
    if (request.workspaceId !== undefined && request.workspaceId !== owner.entityId) {
      throw new OrchestrationError(
        'validation',
        'Workspace file owner does not match the invocation target'
      )
    }
    const { executeWorkspaceCliRequest } = await import('@/lib/mothership/agent-cli/workspace')
    return executeWorkspaceCliRequest(request, context, owner.entityId)
  },
  async readMetadata(context, target) {
    const trusted = requireTrustedCopilotExecutionContext(context)
    if (trusted.workspaceId !== target.owner.entityId) {
      throw new OrchestrationError('not_found', 'File owner not found in this invocation')
    }
    const { file } = await executeCopilotFileUseCase(
      context,
      readWorkspaceFileMetadata,
      { fileId: target.fileId, assertedWorkspaceId: target.owner.entityId },
      { fileId: target.fileId }
    )
    return {
      id: target.fileId,
      name: file.name,
      owner: { entityType: 'workspace', entityId: target.owner.entityId },
    }
  },
}
