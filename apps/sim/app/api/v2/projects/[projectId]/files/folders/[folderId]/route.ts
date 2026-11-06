import { v2UpdateProjectFileFolderContract } from '@/lib/api/contracts/v2/project-file-folders'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileFolder } from '@/lib/projects/files/api/presenters'
import { updateProjectFileFolder } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateProjectFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.updateFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateProjectFileFolder,
  present: ({ folder }) => ({ data: toV2ProjectFileFolder(folder) }),
})
