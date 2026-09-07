import { db } from '@sim/db'
import { scimConnection, scimUser } from '@sim/db/schema'
import { type AnyColumn, and, eq, type SQL, sql } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application'
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

export type ManagedMembershipAction = 'invite' | 'change-role' | 'workspace-grant'

const ACTION_WORDING: Record<ManagedMembershipAction, string> = {
  invite: 'Inviting a member',
  'change-role': 'Changing a member’s role',
  'workspace-grant': 'Granting workspace access',
}

/**
 * Whether this organization has handed membership to its directory.
 *
 * Read fresh rather than cached: the setting is toggled rarely, and a stale
 * answer would either block an administrator who just turned locking off or
 * admit a change the directory is about to revert.
 */
async function loadLockedConnection(
  tx: DbOrTx,
  organizationId: string
): Promise<{ id: string } | null> {
  const [connection] = await tx
    .select({ id: scimConnection.id, settings: scimConnection.settings })
    .from(scimConnection)
    .where(
      and(eq(scimConnection.organizationId, organizationId), eq(scimConnection.status, 'active'))
    )
    .limit(1)
  if (!connection?.settings?.lockManualMembership) return null
  return { id: connection.id }
}

/** True when the user is provisioned by the organization's directory. */
export async function isScimManagedUser(
  tx: DbOrTx,
  params: { organizationId: string; userId: string }
): Promise<boolean> {
  const connection = await loadLockedConnection(tx, params.organizationId)
  if (!connection) return false
  const [row] = await tx
    .select({ id: scimUser.id })
    .from(scimUser)
    .where(and(eq(scimUser.connectionId, connection.id), eq(scimUser.userId, params.userId)))
    .limit(1)
  return Boolean(row)
}

/** Refuses a change to a member the directory owns. */
export async function assertMembershipNotScimManaged(params: {
  organizationId: string
  userId: string
  action: ManagedMembershipAction
  executor?: DbOrTx
}): Promise<void> {
  const managed = await isScimManagedUser(params.executor ?? db, {
    organizationId: params.organizationId,
    userId: params.userId,
  })
  if (!managed) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    `${ACTION_WORDING[params.action]} is managed by this organization’s identity provider. Make the change there, or turn off managed-membership locking in the organization’s directory settings.`
  )
}

/**
 * A SQL predicate that is true when the given user is provisioned by an active
 * directory connection whose organization has locked manual membership.
 *
 * Exposed as a predicate rather than a query so a caller that is already reading
 * the user can fold it into that read. The invitation flow does exactly that: it
 * looks the invitee up by email regardless, and paying for a second round trip
 * on every invitation to answer a question that is almost always "no" is not
 * worth it.
 */
export function scimManagedUserPredicate(userIdColumn: SQL | AnyColumn): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
    from ${scimUser}
    join ${scimConnection} on ${scimConnection.id} = ${scimUser.connectionId}
    where ${scimUser.userId} = ${userIdColumn}
      and ${scimConnection.status} = 'active'
      and coalesce((${scimConnection.settings} ->> 'lockManualMembership')::boolean, false) = true
  )`
}

/** Refuses an invitation to someone the directory already provisions. */
export function assertInviteeNotScimManaged(managed: boolean | null | undefined): void {
  if (!managed) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This person is provisioned by the organization’s identity provider, so Sim will not grant them access separately. They already have access, or will once the next directory sync runs.'
  )
}
