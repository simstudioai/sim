import { v2RevertProjectFileVersionContract } from '@/lib/api/contracts/v2/project-file-versions'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toProjectFileVersion, toV2ProjectFile } from '@/lib/projects/files/api'
import { revertProjectFileVersion } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
export const POST = defineV2JsonRoute({
  contract: v2RevertProjectFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.revertVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    version: params.version,
    expectedCurrentVersion: body.expectedCurrentVersion,
    expectedRevision: body.expectedRevision,
  }),
  useCase: revertProjectFileVersion,
  present: ({ file, version, reverted }) => ({
    data: {
      file: toV2ProjectFile(file),
      version: toProjectFileVersion(version),
      reverted,
      ...workspaceFileRevisionField(file),
    },
  }),
})
