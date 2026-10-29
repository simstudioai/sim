import { workspaceFileFolderStatsContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { getWorkspaceFileFolderStats } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'

/**
 * GET /api/workspaces/[id]/files/folder-stats — live file count and bytes under each child
 * folder of `parentId` (default the root), each folder's subtree rolled up.
 */
export const GET = defineInternalJsonRoute({
  contract: workspaceFileFolderStatsContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-files.read' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => ({ workspaceId: params.id, parentId: query.parentId }),
  useCase: getWorkspaceFileFolderStats,
  present: ({ folders }) => ({ success: true as const, folders }),
})
