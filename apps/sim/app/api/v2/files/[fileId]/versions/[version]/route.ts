import {
  v2DeleteFileVersionContract,
  v2GetFileVersionContract,
} from '@/lib/api/contracts/v2/file-versions'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import {
  deleteWorkspaceFileVersion,
  readWorkspaceFileVersion,
} from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileVersion } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/files/[fileId]/versions/[version] — Read one version's metadata. */
export const GET = defineV2JsonRoute({
  contract: v2GetFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.readVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    version: params.version,
  }),
  useCase: readWorkspaceFileVersion,
  present: async ({ version }) => ({ data: await toV2FileVersion(version) }),
})

/** DELETE /api/v2/files/[fileId]/versions/[version] — Permanently delete a superseded version. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.deleteVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    version: params.version,
  }),
  useCase: deleteWorkspaceFileVersion,
  present: ({ file, version }) => ({ data: { fileId: file.id, version, deleted: true as const } }),
})
