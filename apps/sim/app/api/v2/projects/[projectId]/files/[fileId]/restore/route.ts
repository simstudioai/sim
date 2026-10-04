import { v2RestoreProjectFileContract } from '@/lib/api/contracts/v2/project-file-lifecycle'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { restoreProjectFile } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2RestoreProjectFileContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.restore,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ ...params }),
  useCase: restoreProjectFile,
  present: ({ file }) => ({ data: toV2ProjectFile(file) }),
})
