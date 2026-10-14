import {
  readProjectFileContentContract,
  updateProjectFileContentContract,
} from '@/lib/api/contracts/project-files'
import {
  defineInternalBinaryRoute,
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { presentProjectFileContent } from '@/lib/projects/files/api'
import { readProjectFileContent, updateProjectFileContent } from '@/lib/projects/files/application'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'

export const GET = defineInternalBinaryRoute({
  contract: readProjectFileContentContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: readProjectFileContent.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated internal file byte delivery follows the workspace download policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ projectId: params.id, fileId: params.fileId }),
  useCase: readProjectFileContent,
  present: presentProjectFileContent,
})

export const PUT = defineInternalJsonRoute({
  contract: updateProjectFileContentContract,
  auth: internalSessionAuth,
  operation: updateProjectFileContent.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.write' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string' && typeof params.fileId === 'string')
      await updateProjectFileContent.authorize({
        principal,
        input: { projectId: params.id, fileId: params.fileId, content: '', encoding: 'utf-8' },
      })
  },
  mapInput: ({ params, body }) => ({
    projectId: params.id,
    fileId: params.fileId,
    content: body.content,
    encoding: body.encoding ?? 'utf-8',
    contentType: body.contentType,
    expectedRevision: body.expectedRevision,
    ...(body.expectedUpdatedAt ? { expectedUpdatedAt: new Date(body.expectedUpdatedAt) } : {}),
  }),
  useCase: updateProjectFileContent,
  present: (result) => result,
})
