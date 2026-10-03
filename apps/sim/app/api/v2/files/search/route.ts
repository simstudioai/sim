import { parseFolderPathList, v2SearchFileContentContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v2/files/search — search the indexed text of workspace files.
 *
 * `folderPaths` confines the search to a folder tree, and narrows the reported
 * index coverage with it, so `complete` describes the folders searched. That
 * matters for a caller deciding whether a fact is missing: an incomplete index
 * means unknown, not absent.
 *
 * Head-safe: nothing is written and no audit is projected, matching the other
 * file read operations.
 */
export const GET = defineV2JsonRoute({
  contract: v2SearchFileContentContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.searchContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    query: query.query,
    mode: query.mode,
    maxResults: query.maxResults,
    folderPaths:
      query.folderPaths === undefined ? undefined : parseFolderPathList(query.folderPaths),
    includeSubfolders: query.includeSubfolders,
  }),
  useCase: searchWorkspaceFileContent,
  present: ({ results, count, truncated, complete, indexStatus }) => ({
    data: { results, count, truncated, complete, indexStatus },
  }),
})
