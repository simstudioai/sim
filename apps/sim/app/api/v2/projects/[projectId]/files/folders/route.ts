import {
  v2CreateProjectFileFolderContract,
  v2ListProjectFileFoldersContract,
} from '@/lib/api/contracts/v2/project-file-folders'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileFolder } from '@/lib/projects/files/api/presenters'
import { createProjectFileFolder, listProjectFileFolders } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2ListProjectFileFoldersContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.listFolders,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ ...params, ...query }),
  useCase: listProjectFileFolders,
  present: ({ folders }) => ({ data: folders.map(toV2ProjectFileFolder), nextCursor: null }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateProjectFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.createFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: createProjectFileFolder,
  present: ({ folder }) => ({ data: toV2ProjectFileFolder(folder) }),
})
