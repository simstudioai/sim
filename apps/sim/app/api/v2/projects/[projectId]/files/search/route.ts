import { parseFolderPathList } from '@/lib/api/contracts/v2/files'
import { v2SearchProjectFileContentContract } from '@/lib/api/contracts/v2/project-file-search'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { searchProjectFileContent } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2SearchProjectFileContentContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.searchContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    folderPaths:
      query.folderPaths === undefined ? undefined : parseFolderPathList(query.folderPaths),
  }),
  useCase: searchProjectFileContent,
  present: ({ results, count, truncated, complete, indexStatus }) => ({
    data: { results, count, truncated, complete, indexStatus },
  }),
})
