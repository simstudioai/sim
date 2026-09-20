import { v2RevertFileVersionContract } from '@/lib/api/contracts/v2/file-versions'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { revertWorkspaceFileVersion } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2File, toV2FileVersion } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/[fileId]/versions/[version]/revert — Make a version's content current again.
 *
 * Writes the version's bytes as a new version, so the revert can itself be reverted. Reverting to
 * the current version is a no-op that reports `reverted: false`.
 */
export const POST = defineV2JsonRoute({
  contract: v2RevertFileVersionContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.revertVersion,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
    version: params.version,
    expectedCurrentVersion: body.expectedCurrentVersion,
  }),
  useCase: revertWorkspaceFileVersion,
  present: async ({ file, version, reverted }) => {
    const [v2File, v2Version] = await Promise.all([toV2File(file), toV2FileVersion(version)])
    return { data: { reverted, file: v2File, version: v2Version } }
  },
})
