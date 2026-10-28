import { v2CreateProjectFileUploadContract } from '@/lib/api/contracts/v2/project-file-uploads'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toV2ProjectFileUpload } from '@/lib/projects/files/api/upload-presenter'
import { createProjectFileUploadSession } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2CreateProjectFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.uploadCreate,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    projectId: params.projectId,
    fileName: body.name,
    contentType: body.contentType,
    fileSize: body.size,
    folderId: body.folderId,
    folderPath: body.folderPath,
  }),
  useCase: createProjectFileUploadSession,
  present: (session) => ({
    data: {
      session: toV2ProjectFileUpload(session, null),
      uploadToken: session.uploadToken,
      transfer: session.transfer,
    },
  }),
})
