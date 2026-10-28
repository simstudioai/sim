import { v2RenameProjectFileContract } from '@/lib/api/contracts/v2/project-file-lifecycle'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { renameProjectFile } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const PATCH = defineV2JsonRoute({
  contract: v2RenameProjectFileContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.rename,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: renameProjectFile,
  present: ({ file }) => ({ data: toV2ProjectFile(file) }),
})
