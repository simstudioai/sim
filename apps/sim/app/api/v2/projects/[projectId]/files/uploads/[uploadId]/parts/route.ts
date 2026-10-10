import { v2GetProjectFileUploadPartUrlsContract } from '@/lib/api/contracts/v2/project-file-uploads'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { getProjectFileUploadPartUrls } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2GetProjectFileUploadPartUrlsContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.uploadParts,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, headers, body }) => ({
    projectId: params.projectId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: getProjectFileUploadPartUrls,
  present: (result) => ({ data: result }),
})
