import { v2RestoreProjectFileFolderContract } from '@/lib/api/contracts/v2/project-file-folders'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileFolder } from '@/lib/projects/files/api/presenters'
import { restoreProjectFileFolder } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2RestoreProjectFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.restoreFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ ...params }),
  useCase: restoreProjectFileFolder,
  present: ({ folder, restoredItems }) => ({
    data: { folder: toV2ProjectFileFolder(folder), restoredItems },
  }),
})
