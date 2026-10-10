import {
  v2DeleteProjectFileVersionContract,
  v2GetProjectFileVersionContract,
} from '@/lib/api/contracts/v2/project-file-versions'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { toProjectFileVersion } from '@/lib/projects/files/api'
import { deleteProjectFileVersion, readProjectFileVersion } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'
export const GET = defineV2JsonRoute({
  contract: v2GetProjectFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.readVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: readProjectFileVersion,
  present: ({ version }) => ({ data: toProjectFileVersion(version) }),
})
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteProjectFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: projectFileOperations.deleteVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ params }) => ({
    projectId: params.projectId,
    fileId: params.fileId,
    version: params.version,
  }),
  useCase: deleteProjectFileVersion,
  present: ({ file, version }) => ({ data: { fileId: file.id, version, deleted: true as const } }),
})
