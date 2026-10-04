import {
  v2AbortProjectFileUploadContract,
  v2GetProjectFileUploadContract,
} from '@/lib/api/contracts/v2/project-file-uploads'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileUpload } from '@/lib/projects/files/api/upload-presenter'
import {
  abortProjectFileUploadSession,
  getProjectFileUploadSession,
} from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetProjectFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.uploadRead,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.projectId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: getProjectFileUploadSession,
  present: ({ session, file }) => ({ data: toV2ProjectFileUpload(session, file) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2AbortProjectFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.uploadCancel,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.projectId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: abortProjectFileUploadSession,
  present: (session) => ({ data: toV2ProjectFileUpload(session, null) }),
})
