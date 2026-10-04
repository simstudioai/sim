import { createProjectFileUploadContract } from '@/lib/api/contracts/project-file-uploads'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileUpload } from '@/lib/projects/files/api'
import { createProjectFileUploadSession } from '@/lib/projects/files/application'
import { requestOrigin } from '@/lib/uploads/upload-session/application'

export const POST = defineInternalJsonRoute({
  contract: createProjectFileUploadContract,
  auth: internalSessionAuth,
  operation: createProjectFileUploadSession.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.upload' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }, { request }) => ({
    projectId: params.id,
    localOrigin: requestOrigin(request),
    fileName: body.name,
    contentType: body.contentType,
    fileSize: body.size,
    folderId: body.folderId,
    folderPath: body.folderPath,
  }),
  useCase: createProjectFileUploadSession,
  present: (session) => ({
    session: presentProjectFileUpload(session, null),
    uploadToken: session.uploadToken,
    transfer: session.transfer,
  }),
})
