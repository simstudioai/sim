import {
  deleteProjectFileVersionContract,
  getProjectFileVersionContract,
} from '@/lib/api/contracts/project-file-versions'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toProjectFileVersion } from '@/lib/projects/files/api'
import { deleteProjectFileVersion, readProjectFileVersion } from '@/lib/projects/files/application'
export const GET = defineInternalJsonRoute({
  contract: getProjectFileVersionContract,
  auth: internalSessionAuth,
  operation: readProjectFileVersion.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.history' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.id,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: readProjectFileVersion,
  present: ({ version }) => ({ version: toProjectFileVersion(version) }),
})
export const DELETE = defineInternalJsonRoute({
  contract: deleteProjectFileVersionContract,
  auth: internalSessionAuth,
  operation: deleteProjectFileVersion.operation,
  rateLimit: internalRateLimits.user({ bucketName: 'project-files.history' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.id,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: deleteProjectFileVersion,
  present: ({ file, version }) => ({ fileId: file.id, version, deleted: true as const }),
})
