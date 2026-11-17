import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { v2CaughtOrchestrationError, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

/**
 * Workspace source routes conceal an unreachable workspace as absent. A refused apply answers its
 * status (`400`, `409` stale, `423` locked, `413` over a limit) with `details.diagnostics`;
 * `details.code` is `SOURCE_STALE` when a resource changed since the directory was read, else
 * `SOURCE_REJECTED`.
 */
export const v2WorkspaceSourceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
  render(error) {
    if (error instanceof WorkspaceSourceRejectedError) {
      return v2ErrorForOrchestration(error.code, error.message, {
        code: error.stale ? 'SOURCE_STALE' : 'SOURCE_REJECTED',
        diagnostics: error.diagnostics,
      })
    }
    return v2CaughtOrchestrationError(error)
  },
})
