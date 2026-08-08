import {
  createWorkspaceFileFolderContract,
  listWorkspaceFileFoldersContract,
} from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  createWorkspaceFileFolderOperation,
  listWorkspaceFileFoldersOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFileFoldersContract,
  auth: internalSessionAuth,
  operation: fileOperations.listFolders,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder listing behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, scope: query.scope }),
  useCase: listWorkspaceFileFoldersOperation,
  present: ({ folders }) => ({ success: true, folders }),
})

export const POST = defineInternalJsonRoute({
  contract: createWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.createFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder creation behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    name: body.name,
    parentId: body.parentId,
  }),
  useCase: createWorkspaceFileFolderOperation,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'folder_created',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ folder }) => ({ success: true, folder }),
})
