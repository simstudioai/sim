import type { ApplicationOperation } from '@/lib/core/application'
import { assertOperationCapability } from '@/lib/core/application'

function defineUserAccountOperation<const Id extends string>(
  operation: ApplicationOperation<Id>
): ApplicationOperation<Id> {
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

/**
 * Operations an account performs on itself. They carry no workspace scope and no
 * role: the resource *is* the authenticated principal, so a session is both the
 * only acceptable credential and the whole authorization story. That policy is
 * enforced where it can actually hold — `internalSessionAuth` on the route and
 * the principal guard in each use case — rather than restated as inert data here.
 */
export const userAccountOperations = {
  // permission-group-exempt: the resource is the account itself, and a permission group scopes a workspace the account may leave rather than the account
  previewDeletion: defineUserAccountOperation({
    id: 'users.account.deletion_preview',
    capability: 'none',
  }),
  // permission-group-exempt: deleting your own account is not a workspace act, so no group key names it
  delete: defineUserAccountOperation({ id: 'users.account.delete', capability: 'none' }),
} as const satisfies Record<string, ApplicationOperation>
