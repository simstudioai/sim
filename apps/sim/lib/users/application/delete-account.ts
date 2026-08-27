import { AuditAction, AuditResourceType, recordAuditBatch } from '@sim/audit'
import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { normalizeEmail } from '@sim/utils/string'
import type { AccountDeletionPlan } from '@/lib/api/contracts/user'
import type { OperationUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { deleteUserAccount, getAccountDeletionPlan } from '@/lib/users/account-deletion'
import { userAccountOperations } from '@/lib/users/application/operations'
import { getUserProfile } from '@/lib/users/queries'

/**
 * An account operation is only ever performed by the account itself, so every use
 * case here starts by refusing anything that is not a first-party session — an API
 * key or a delegated service must never be able to erase the human behind it.
 * Defence in depth: the route's `internalSessionAuth` already returns nothing else.
 */
function requireSelf(principal: Principal): asserts principal is SessionPrincipal {
  if (principal.kind !== 'session') {
    throw new OrchestrationError('forbidden', 'Session authentication required')
  }
}

export const previewAccountDeletionUseCase: OperationUseCase<
  typeof userAccountOperations.previewDeletion,
  Record<string, never>,
  AccountDeletionPlan
> = {
  operation: userAccountOperations.previewDeletion,
  async execute({ principal }) {
    requireSelf(principal)
    return getAccountDeletionPlan(principal.userId)
  },
}

export interface DeleteAccountInput {
  /** The account's own email address, retyped. */
  confirmEmail: string
}

export const deleteAccountUseCase: OperationUseCase<
  typeof userAccountOperations.delete,
  DeleteAccountInput,
  AccountDeletionPlan
> = {
  operation: userAccountOperations.delete,
  async execute({ principal, input }) {
    requireSelf(principal)

    const profile = await getUserProfile(principal.userId)
    if (!profile) throw new OrchestrationError('not_found', 'Account not found')

    /**
     * Normalized on both sides because the confirmation exists to prove intent,
     * not to test typing — but it is still compared against the account's own
     * address, so a mis-wired client cannot delete somebody else's account.
     */
    if (normalizeEmail(input.confirmEmail) !== normalizeEmail(profile.email)) {
      throw new OrchestrationError(
        'validation',
        'Enter your account email exactly as it appears above to confirm.'
      )
    }

    const plan = await deleteUserAccount(principal.userId)

    /**
     * The compliance record deliberately carries no actor identity: the person it
     * would name has just exercised their right to erasure. `recordAuditBatch`
     * inserts exactly what it is given, unlike `recordAudit`, whose lazy actor
     * lookup would race the row that no longer exists.
     */
    recordAuditBatch([
      {
        workspaceId: null,
        actorId: null,
        action: AuditAction.ACCOUNT_DELETED,
        resourceType: AuditResourceType.ACCOUNT,
        resourceId: principal.userId,
        description: 'Account deleted at the account holder’s request',
        metadata: {
          operation: userAccountOperations.delete.id,
          workspacesDeleted: plan.workspacesToDelete.length,
          workspacesTransferred: plan.workspacesToTransfer.length,
        },
      },
    ])

    return plan
  },
}
