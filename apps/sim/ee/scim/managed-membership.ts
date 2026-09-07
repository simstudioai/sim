import { db } from '@sim/db'
import { scimConnection, scimUser } from '@sim/db/schema'
import { type AnyColumn, type SQL, sql } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application'
import { isScimEnabled } from '@/lib/core/config/env-flags'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Refusing membership edits that the organization's directory owns.
 *
 * When an administrator makes the directory the source of truth, a change made
 * only in Sim is undone by the next sync. Accepting it would be worse than
 * refusing: the person doing it sees success, the change disappears hours later,
 * and nothing explains why. This turns that into an error that names the
 * remedy.
 *
 * Deliberately not applied to deprovisioning: an administrator must always be
 * able to remove someone in an emergency, whatever the directory believes.
 */

/**
 * A SQL predicate that is true when the given user is provisioned by THIS
 * organization's active directory connection and that connection has locked
 * manual membership.
 *
 * Anchored to the organization on purpose. Without that anchor, a person
 * provisioned by one tenant's directory would be reported as managed to every
 * other tenant that happens to look them up — a false refusal and a
 * cross-tenant disclosure in one.
 *
 * Exposed as a predicate rather than a query so a caller that is already
 * reading the user can fold it into that read; the invitation flow does, since
 * paying a second round trip on every invitation to answer a question that is
 * almost always "no" is not worth it.
 */
export function scimManagedUserPredicate(
  organizationId: string,
  userIdColumn: SQL | AnyColumn
): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${scimUser}
    join ${scimConnection} on ${scimConnection.id} = ${scimUser.connectionId}
    where ${scimUser.userId} = ${userIdColumn}
      and ${scimConnection.organizationId} = ${organizationId}
      and ${scimConnection.status} = 'active'
      and coalesce((${scimConnection.settings} ->> 'lockManualMembership')::boolean, false) = true
  )`
}

/** Refuses a change to a member the directory owns. */
export async function assertMembershipNotScimManaged(params: {
  organizationId: string
  userId: string
  executor?: DbOrTx
}): Promise<void> {
  /**
   * A deployment or plan that no longer has directory provisioning must not keep
   * refusing manual changes on behalf of a directory that can no longer sync.
   */
  if (!isScimEnabled) return
  const [row] = await (params.executor ?? db)
    .select({ managed: scimManagedUserPredicate(params.organizationId, sql`${params.userId}`) })
    .from(sql`(select 1) as probe`)
  if (!row?.managed) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This member is managed by the organization’s identity provider. Make the change there, or turn off managed-membership locking in the organization’s directory settings.'
  )
}

/** Refuses an invitation to someone the directory already provisions. */
export function assertInviteeNotScimManaged(managed: boolean | null | undefined): void {
  if (!managed) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This person is provisioned by the organization’s identity provider, so Sim will not grant them access separately. They already have access, or will once the next directory sync runs.'
  )
}
