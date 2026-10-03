import { db } from '@sim/db'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'

/** Holds entitlement and group state stable for the entire mutation. */
export function withPermissionGroupMutation<T>(
  organizationId: string,
  mutate: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireOrganizationMutationLock(tx, organizationId)
    await acquirePermissionGroupOrgLock(tx, organizationId, { lockTimeoutAlreadyBounded: true })
    if (!(await isOrganizationPermissionRegimeActive(organizationId, tx)))
      throw new ForbiddenOperationError(
        'ENTERPRISE_PLAN_REQUIRED',
        'Access Control is an Enterprise feature'
      )
    return mutate(tx)
  })
}
