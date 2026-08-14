import {
  v2CreateWorkflowFolderContract,
  v2DeleteWorkflowFolderContract,
  v2ListWorkflowFoldersContract,
  v2RelocateWorkflowFolderContract,
} from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  createWorkflowFolder,
  deleteWorkflowFolder,
  listWorkflowFolders,
  relocateWorkflowFolder,
} from '@/lib/workflows/application/workflow-folders'
import { toV2PathFolder } from '@/app/api/v2/lib/folders'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function toV2WorkflowFolder(
  folder: Parameters<typeof toV2PathFolder>[0],
  index: Parameters<typeof toV2PathFolder>[1]
) {
  const view = toV2PathFolder(folder, index, true)
  if (!('locked' in view)) throw new Error('Workflow folder projection omitted lock state')
  return view
}

export const GET = defineV2JsonRoute({
  contract: v2ListWorkflowFoldersContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listFolders,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    parentPath: query.parentPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }),
  useCase: listWorkflowFolders,
  present: ({ folders, index }) => ({
    data: folders.map((folder) => toV2WorkflowFolder(folder, index)),
    nextCursor: null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateWorkflowFolderContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.createFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.default,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, path: body.path }),
  useCase: createWorkflowFolder,
  present: ({ folder, index }) => ({ data: toV2WorkflowFolder(folder, index) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2RelocateWorkflowFolderContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.relocateFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    path: body.path,
    destinationPath: body.destinationPath,
  }),
  useCase: relocateWorkflowFolder,
  present: ({ folder, index }) => ({ data: toV2WorkflowFolder(folder, index) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteWorkflowFolderContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.deleteFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    path: query.path,
    recursive: query.recursive,
  }),
  useCase: deleteWorkflowFolder,
  present: ({ path, deletedItems }) => ({
    data: { path, deleted: true as const, deletedItems },
  }),
})
