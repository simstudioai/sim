import {
  abortProjectFileUploadContract,
  getProjectFileUploadContract,
} from '@/lib/api/contracts/project-file-uploads'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileUpload } from '@/lib/projects/files/api'
import {
  abortProjectFileUploadSession,
  getProjectFileUploadSession,
} from '@/lib/projects/files/application'

export const GET = defineInternalJsonRoute({
  contract: getProjectFileUploadContract,
  auth: internalSessionAuth,
  operation: getProjectFileUploadSession.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.upload' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.id,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: getProjectFileUploadSession,
  present: ({ session, file }) => presentProjectFileUpload(session, file),
})

export const DELETE = defineInternalJsonRoute({
  contract: abortProjectFileUploadContract,
  auth: internalSessionAuth,
  operation: abortProjectFileUploadSession.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.upload' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, headers }) => ({
    projectId: params.id,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: abortProjectFileUploadSession,
  present: (session) => presentProjectFileUpload(session, null),
})
