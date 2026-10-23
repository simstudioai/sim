import {
  v2GetProjectFileShareContract,
  v2UpdateProjectFileShareContract,
} from '@/lib/api/contracts/v2/project-file-shares'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import {
  getProjectFileShare,
  updateProjectFileShare,
} from '@/lib/projects/files/application/shares'

export const GET = defineV2JsonRoute({
  contract: v2GetProjectFileShareContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.readShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.projectId, fileId: params.fileId }),
  useCase: getProjectFileShare,
  present: ({ share }) => ({ data: share }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateProjectFileShareContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.updateShare,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    ...body,
  }),
  useCase: updateProjectFileShare,
  present: ({ share }) => ({ data: share }),
})
