import { findCause } from '@sim/utils/errors'
import {
  createInternalResourceConcealmentPolicy,
  createV2ResourceConcealmentPolicy,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import { WorkspaceBusyError } from '@/lib/workspaces/permissions/management-store'
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
   * Member administration adds two actionable failures the shared projection
   * would answer as 500: an owner removal with no billing account to inherit
   * (409) and contention that outlived the transaction (503, whether the
   * removal's driver error or the role store's busy refusal surfaces it).
   */
  manageWorkspaceMembers: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workspace not found',
    render(error) {
      if (error instanceof WorkspaceBillingAccountRemovalError)
        return v2Error('CONFLICT', error.message)
      if (
        isRetryableTransactionError(error) ||
        findCause(
          error,
          (cause): cause is WorkspaceBusyError => cause instanceof WorkspaceBusyError
        )
      )
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
