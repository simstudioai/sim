import {
  createInternalResourceConcealmentPolicy,
  createV2ResourceConcealmentPolicy,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import { WorkspaceBillingAccountRemovalError } from '@/lib/workspaces/utils'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

/**
 * A caller naming a workspace it cannot reach must not be able to tell that
 * refusal apart from a workspace that does not exist. Both answer
 * `404 "Workspace not found"` — the message the unknown-workspace path in
 * `get-public-workspace` and `list-public-workspace-members` already uses, so
 * the two responses are byte-identical.
 */
export const v2WorkspaceErrorPolicies = {
  concealWorkspaceAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
  }),
  /**
   * Member administration adds two failures a caller can act on that the
   * shared projection would answer as 500: an owner whose removal leaves no
   * billing account to inherit the workspace (a state conflict, resolved by
   * reassigning billing), and contention that outlived the transaction (resolved
   * by waiting).
   */
  manageWorkspaceMembers: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
    render(error) {
      if (error instanceof WorkspaceBillingAccountRemovalError)
        return v2Error('CONFLICT', error.message)
      if (isRetryableTransactionError(error))
        return v2Error('SERVICE_UNAVAILABLE', 'The workspace is busy; retry in a moment')
      return v2CaughtOrchestrationError(error)
    },
  }),
} as const

export const internalWorkspaceErrorPolicies = {
  concealWorkspaceAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: 'Workspace not found',
  }),
} as const
