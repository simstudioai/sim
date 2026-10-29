import { searchWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalFilePresenters } from '@/lib/workspace-files/api'
import { listWorkspaceFileCollection } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'

/** Sized for debounced type-ahead: a burst while typing, about two searches a second sustained. */
const SEARCH_TYPE_AHEAD_LIMIT = { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 }

/**
 * GET /api/workspaces/[id]/files/search — live files whose name contains `q`, by name, each
 * carrying its `folderPath`; within `folderId` (and, by default, its subfolders) when given.
 */
export const GET = defineInternalJsonRoute({
  contract: searchWorkspaceFilesContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  rateLimit: internalRateLimits.user({
    bucketName: 'workspace-files.search',
    config: SEARCH_TYPE_AHEAD_LIMIT,
  }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => ({
    workspaceId: params.id,
    scope: 'active' as const,
    page: {
      search: query.q,
      folderId: query.folderId,
      recursive: query.recursive,
      sortBy: 'name' as const,
      sortOrder: 'asc' as const,
      limit: query.limit,
    },
  }),
  useCase: listWorkspaceFileCollection,
  present: internalFilePresenters.successFiles,
})
