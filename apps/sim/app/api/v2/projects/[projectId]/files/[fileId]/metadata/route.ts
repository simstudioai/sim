import { v2GetProjectFileMetadataContract } from '@/lib/api/contracts/v2/project-files'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { getProjectFileMetadata } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetProjectFileMetadataContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.readMetadata,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getProjectFileMetadata,
  present: ({ file }) => ({ data: toV2ProjectFile(file) }),
})
