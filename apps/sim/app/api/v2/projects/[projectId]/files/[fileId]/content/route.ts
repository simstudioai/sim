import {
  v2ReadProjectFileContentContract,
  v2UpdateProjectFileContentContract,
} from '@/lib/api/contracts/v2/project-files'
import {
  defineV2BinaryRoute,
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentProjectFileContent } from '@/lib/projects/files/api'
import { toV2ProjectFile } from '@/lib/projects/files/api/presenters'
import { readProjectFileContent, updateProjectFileContent } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'

export const GET = defineV2BinaryRoute({
  contract: v2ReadProjectFileContentContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.readContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.projectId, fileId: params.fileId }),
  useCase: readProjectFileContent,
  present: presentProjectFileContent,
})

export const PUT = defineV2JsonRoute({
  contract: v2UpdateProjectFileContentContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.updateContent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  mapInput: ({ params, body }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    content: body.content,
    encoding: body.encoding,
    expectedRevision: body.expectedRevision,
  }),
  useCase: updateProjectFileContent,
  present: ({ file }) => ({ data: toV2ProjectFile(file) }),
})
