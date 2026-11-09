import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { folderOperations } from '@/lib/folders/application/operations'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import type { FolderQueryScope } from '@/hooks/queries/utils/folder-keys'

export interface ListWorkspaceFoldersInput {
  workspaceId: string
  resourceType: FolderResourceType
  scope: FolderQueryScope
}

/** One resource family's folders in a workspace, in their tree order. */
export const listWorkspaceFoldersUseCase = defineAuthorizedWorkspaceUseCase({
  operation: folderOperations.list,
  resolveContext: ({ input }: { input: ListWorkspaceFoldersInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: ({ input, context }) =>
    listFoldersForWorkspace(context.workspaceId, input.scope, input.resourceType),
})
