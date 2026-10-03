import { scimConnection, scimUser } from '@sim/db/schema'
import { type AnyColumn, Column, getTableName, is, type SQL, sql } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application'
import type { DbOrTx } from '@/lib/db/types'
import { isScimDeploymentEnabled, isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

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
  const userId = is(userIdColumn, Column) ? qualifiedColumn(userIdColumn) : userIdColumn
  return sql<boolean>`exists (
    select 1
    from ${scimUser}
    join ${scimConnection} on ${qualifiedColumn(scimConnection.id)} = ${qualifiedColumn(scimUser.connectionId)}
    where ${qualifiedColumn(scimUser.userId)} = ${userId}
      and ${qualifiedColumn(scimConnection.organizationId)} = ${organizationId}
      and ${qualifiedColumn(scimConnection.status)} = 'active'
      and coalesce((${qualifiedColumn(scimConnection.settings)} ->> 'lockManualMembership')::boolean, false) = true
  )`
}

/**
 * Drizzle removes Column qualifiers from single-table SELECT expressions,
 * including nested SQL. Explicit identifiers preserve this subquery's joins
 * and outer correlation, using the column's current table name or alias.
 */
function qualifiedColumn(column: AnyColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
}

/** Refuses a change to a member the directory owns. */
export async function assertMembershipNotScimManaged(params: {
  organizationId: string
  userId: string
  executor: DbOrTx
}): Promise<void> {
  if (!isScimDeploymentEnabled()) return
  const [row] = await params.executor
    .select({ managed: scimManagedUserPredicate(params.organizationId, sql`${params.userId}`) })
    .from(sql`(select 1) as probe`)
  if (!row?.managed) return
  /**
   * A plan that no longer has directory provisioning must not keep refusing
   * manual changes on behalf of a directory that can no longer sync. Read only
   * once a managed row is found, so the common case costs nothing.
   */
  if (!(await isScimEntitledForOrganization(params.organizationId, params.executor))) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This member is managed by the organization’s identity provider. Make the change there, or turn off managed-membership locking in the organization’s directory settings.'
  )
}

/** Refuses an invitation to someone the directory already provisions, while the directory can still sync. */
export async function assertInviteeNotScimManaged(params: {
  organizationId: string
  managed: boolean | null | undefined
}): Promise<void> {
  if (!params.managed) return
  if (!(await isScimEntitledForOrganization(params.organizationId))) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This person is provisioned by the organization’s identity provider, so Sim will not grant them access separately. They already have access, or will once the next directory sync runs.'
  )
}
