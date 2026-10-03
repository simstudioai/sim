import {
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { ArchiveError, statusForArchiveError } from '@/lib/uploads/archive'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { v2CaughtOrchestrationError, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

export const internalSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  resourceScope: (params) => {
    const fileId = typeof params.fileId === 'string' ? params.fileId : undefined
    return fileId ? { fileId } : undefined
  },
})

/**
 * Generated-document serving authorizes the root file and every referenced input. Its executor
 * Principal is therefore intentionally workspace-scoped; a file-scoped Principal could authorize
 * the root or one dependency, but never the full dependency graph.
 */
export const internalWorkspaceFileServeAuth = createInternalSessionOrExecutorAuth({
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
})

export const v2FileErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealResourceAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'File not found',
  }) satisfies V2ErrorPolicy,
  /**
   * Resource-ID upload controls conceal the *authorization* failure as absence,
   * so a caller holding a valid API key learns nothing about an upload session
   * belonging to a workspace it cannot reach. Workspace-policy denials keep
   * their own `403`.
   */
  concealUploadAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Upload session not found',
  }) satisfies V2ErrorPolicy,
  /**
   * Unarchiving is the one file operation whose *payload* can be at fault: a
   * malformed archive is the caller's request being wrong, and an archive over
   * a cap is a limit they can act on. Without an arm for it both rendered as a
   * `500`, so the v2 caller was told the server had failed when the answer was
   * `400` or `413` — the internal extract route beside it has said so all
   * along. The status stays decided by `statusForArchiveError`, which classifies
   * every reason in one place; this only carries it into the v2 vocabulary.
   */
  concealExtractionAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'File not found',
    render(error) {
      if (error instanceof ArchiveError) {
        return v2ErrorForOrchestration(
          statusForArchiveError(error) === 413 ? 'payload_too_large' : 'validation',
          error.message
        )
      }
      return v2CaughtOrchestrationError(error)
    },
  }) satisfies V2ErrorPolicy,
} as const
