import { v2ReadProjectFileVersionContentContract } from '@/lib/api/contracts/v2/project-file-versions'
import {
  defineV2BinaryRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentProjectFileVersionContent } from '@/lib/projects/files/api'
import { readProjectFileVersionContent } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
export const GET = defineV2BinaryRoute({
  contract: v2ReadProjectFileVersionContentContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.readVersionContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  headSafe: false,
  mapInput: ({ params }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: readProjectFileVersionContent,
  present: presentProjectFileVersionContent,
})
