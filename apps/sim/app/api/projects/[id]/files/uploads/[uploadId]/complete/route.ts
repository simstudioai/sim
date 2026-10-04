import { completeProjectFileUploadContract } from '@/lib/api/contracts/project-file-uploads'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileUpload } from '@/lib/projects/files/api'
import { completeProjectFileUploadSession } from '@/lib/projects/files/application'

export const POST = defineInternalJsonRoute({
  contract: completeProjectFileUploadContract,
  auth: internalSessionAuth,
  operation: completeProjectFileUploadSession.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.upload' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.id,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeProjectFileUploadSession,
  present: ({ session, value }) => presentProjectFileUpload(session, value.file),
})
