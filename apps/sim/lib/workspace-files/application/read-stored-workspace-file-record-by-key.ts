import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceContext,
  loadActiveWorkspaceContext,
} from '@/lib/uploads/contexts/workspace'
import { type FileMetadataRecord, getFileMetadataByKey } from '@/lib/uploads/server/metadata'
import { isWorkspaceScopedContext } from '@/lib/uploads/shared/types'
import { tryInferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { workspaceFileDelegationPolicy } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'

interface ReadStoredWorkspaceFileByKeyInput {
  key: string
  assertedWorkspaceId: string
}

interface StoredWorkspaceFileContext extends ActiveWorkspaceContext {
  fileId: string
  file: FileMetadataRecord
}

/**
 * Authorizes stored bytes under the shared workspace tenancy of files and chat uploads.
 * Canonical metadata determines ownership; workspace-file CRUD remains workspace-only.
 */
export const readStoredWorkspaceFileRecordByKey = defineAuthorizedWorkspaceUseCase({
  operation: fileOperations.readContent,
  async resolveContext({
    input,
  }: {
    input: ReadStoredWorkspaceFileByKeyInput
  }): Promise<StoredWorkspaceFileContext> {
    if (tryInferContextFromKey(input.key) !== 'workspace') {
      throw new OrchestrationError('not_found', 'File not found')
    }
    const file = await getFileMetadataByKey(input.key, undefined, { includeDeleted: true })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    if (
      !file.workspaceId ||
      file.deletedAt ||
      file.organizationId ||
      file.key !== input.key ||
      !isWorkspaceScopedContext(file.context) ||
      file.workspaceId !== input.assertedWorkspaceId
    ) {
      throw new OrchestrationError('forbidden', 'File not available')
    }
    const workspace = await loadActiveWorkspaceContext(file.workspaceId)
    if (!workspace || workspace.workspaceId !== file.workspaceId) {
      throw new OrchestrationError('forbidden', 'File not available')
    }
    return { ...workspace, fileId: file.id, file }
  },
  authorizationOptions: {
    delegation: {
      audience: workspaceFileDelegationPolicy.audience,
      isWithinScope: (principal, context) =>
        workspaceFileDelegationPolicy.isWithinScope(principal, context) &&
        (context.file.context !== 'mothership' ||
          principal.resourceScope?.chatId === undefined ||
          principal.resourceScope.chatId === context.file.chatId),
    },
  },
  async execute({ input, context }): Promise<{ file: FileMetadataRecord }> {
    const file = await getFileMetadataByKey(input.key)
    if (
      !file ||
      file.deletedAt ||
      file.organizationId ||
      file.id !== context.fileId ||
      file.key !== input.key ||
      file.workspaceId !== context.workspaceId ||
      file.context !== context.file.context ||
      file.chatId !== context.file.chatId
    ) {
      throw new OrchestrationError('forbidden', 'File not available')
    }
    return { file }
  },
})
