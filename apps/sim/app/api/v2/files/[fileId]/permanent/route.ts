import { v2PermanentlyDeleteFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { permanentlyDeleteWorkspaceFileOperation } from '@/lib/workspace-files/application/permanently-delete-workspace-file'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * DELETE /api/v2/files/[fileId]/permanent — irreversibly destroy an archived
 * file's row and stored bytes.
 *
 * `DELETE /api/v2/files/{fileId}` only archives; its bytes are never removed.
 * This is the second half of a deliberate two-step, and a file that is not
 * already archived answers `409` naming the archive step, so no single request
 * can turn a live file into lost bytes.
 *
 * Requires the `admin` role, which also puts it out of reach of workspace API
 * keys: irreversible destruction should not be reachable by an unattended
 * credential.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2PermanentlyDeleteFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.deletePermanent,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: permanentlyDeleteWorkspaceFileOperation,
  present: ({ id, deleted, objectDeleted }) => ({ data: { id, deleted, objectDeleted } }),
})
