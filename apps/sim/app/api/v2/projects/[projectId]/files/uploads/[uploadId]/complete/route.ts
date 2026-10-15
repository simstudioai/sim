import { v2CompleteProjectFileUploadContract } from '@/lib/api/contracts/v2/project-file-uploads'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileUpload } from '@/lib/projects/files/api/upload-presenter'
import { completeProjectFileUploadSession } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2CompleteProjectFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.uploadComplete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.projectId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeProjectFileUploadSession,
  present: ({ session, value }) => ({ data: toV2ProjectFileUpload(session, value.file) }),
})
