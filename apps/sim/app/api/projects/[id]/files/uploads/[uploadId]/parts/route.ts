import { getProjectFileUploadPartUrlsContract } from '@/lib/api/contracts/project-file-uploads'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getProjectFileUploadPartUrls } from '@/lib/projects/files/application'
import { requestOrigin } from '@/lib/uploads/upload-session/application'

export const POST = defineInternalJsonRoute({
  contract: getProjectFileUploadPartUrlsContract,
  auth: internalSessionAuth,
  operation: getProjectFileUploadPartUrls.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.upload' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, headers, body }, { request }) => ({
    projectId: params.id,
    localOrigin: requestOrigin(request),
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: getProjectFileUploadPartUrls,
  present: (result) => result,
})
