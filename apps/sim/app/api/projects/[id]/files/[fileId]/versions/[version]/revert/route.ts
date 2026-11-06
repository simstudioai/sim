import { revertProjectFileVersionContract } from '@/lib/api/contracts/project-file-versions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toProjectFileVersion } from '@/lib/projects/files/api'
import { revertProjectFileVersion } from '@/lib/projects/files/application'
import { workspaceFileRevisionField } from '@/lib/workspace-files/application/file-revision'
export const POST = defineInternalJsonRoute({
  contract: revertProjectFileVersionContract,
  auth: internalSessionAuth,
  operation: revertProjectFileVersion.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.history' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({
    projectId: params.id,
    fileId: params.fileId,
    version: params.version,
    expectedCurrentVersion: body.expectedCurrentVersion,
    expectedRevision: body.expectedRevision,
  }),
  useCase: revertProjectFileVersion,
  present: ({ file, version, reverted }) => ({
    file: file,
    version: toProjectFileVersion(version),
    reverted,
    ...workspaceFileRevisionField(file),
  }),
})
