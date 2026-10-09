import { searchWorkspaceFileContentContract } from '@/lib/api/contracts/workspace-file-search'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: searchWorkspaceFileContentContract,
  auth: internalSessionAuth,
  operation: fileOperations.searchContent,
  rateLimit: internalRateLimits.user({
    bucketName: 'workspace-file-content-search',
    config: { maxTokens: 60, refillRate: 60, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, query }, { request }) => ({
    workspaceId: params.id,
    query: query.query,
    mode: 'exact' as const,
    maxResults: query.maxResults,
    folderPaths: query.folderPath === undefined ? undefined : [query.folderPath],
    includeFileMetadata: true,
    signal: request.signal,
  }),
  useCase: searchWorkspaceFileContent,
  present: ({ results, count, truncated, complete, indexStatus, files }) => ({
    results,
    count,
    truncated,
    complete,
    indexStatus,
    files: files ?? [],
  }),
})
