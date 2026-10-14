import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeCopilotProjectFileUseCase } from '@/lib/mothership/application/execute-project-file-use-case'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import type { CopilotFileOwnerAdapter } from '@/lib/mothership/file-owners/types'
import { canonicalWorkspaceFilePath } from '@/lib/mothership/vfs/path-utils'
import {
  getProjectFileCapabilities,
  getProjectFileMetadata,
} from '@/lib/projects/files/application'
import { fileOwnerVfsPath } from '@/lib/workspace-files/owner-paths'

export const projectFileOwnerAdapter: CopilotFileOwnerAdapter = {
  resourceScope: 'owner',
  async readChatMetadata(ingress, target) {
    if (ingress.requestMode !== 'agent' && ingress.requestMode !== 'plan') {
      throw new OrchestrationError('forbidden', 'Project file context requires agent or plan mode')
    }
    const invocation = ingress.chatId
      ? { kind: 'chat' as const, chatId: ingress.chatId }
      : ingress.workspaceId
        ? { kind: 'workspace' as const, workspaceId: ingress.workspaceId }
        : null
    if (!invocation) {
      throw new OrchestrationError('forbidden', 'File context requires an authoring invocation')
    }
    const context = {
      ...ingress,
      toolCallId: `context:${target.fileId}`,
      copilotToolExecution: true,
      copilotResourceAdmission: createCopilotResourceAdmission({
        userId: ingress.userId,
        invocation,
      }),
    }
    const input = { projectId: target.owner.entityId, fileId: target.fileId }
    const { file } = await executeCopilotProjectFileUseCase(
      context,
      getProjectFileMetadata,
      input,
      input
    )
    return {
      id: file.id,
      name: file.name,
      owner: file.owner,
      path: fileOwnerVfsPath(
        file.owner,
        canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name })
      ),
    }
  },
  async executeCli(request, context, owner) {
    if (request.workspaceId !== undefined) {
      throw new OrchestrationError(
        'validation',
        'A Project file target cannot also select a workspace'
      )
    }
    const { executeProjectFileCliRequest } = await import(
      '@/lib/mothership/agent-cli/project-files'
    )
    return executeProjectFileCliRequest(request, context, owner.entityId)
  },
  async readMetadata(context, { owner, fileId }) {
    const target = { projectId: owner.entityId, fileId }
    const { file } = await executeCopilotProjectFileUseCase(
      context,
      getProjectFileMetadata,
      target,
      target
    )
    return { id: file.id, name: file.name, owner: file.owner }
  },
  capabilities(context, owner) {
    const target = { projectId: owner.entityId }
    return executeCopilotProjectFileUseCase(context, getProjectFileCapabilities, target, target)
  },
}
