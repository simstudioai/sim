import { searchWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalFilePresenters } from '@/lib/workspace-files/api'
import { searchWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'

/** Sized for debounced type-ahead: a burst while typing, about two searches a second sustained. */
const SEARCH_TYPE_AHEAD_LIMIT = { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 }

/**
 * GET /api/workspaces/[id]/files/search — live files `q` finds, best match first: by name
 * (exact, prefix, substring, then fuzzy), then by the folders they sit under; each carries its
 * `folderPath`. Within `folderId` (and, by default, its subfolders) when given.
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
    query: query.q,
    folderId: query.folderId,
    recursive: query.recursive,
    limit: query.limit,
  }),
  useCase: searchWorkspaceFiles,
  present: internalFilePresenters.successFiles,
})
