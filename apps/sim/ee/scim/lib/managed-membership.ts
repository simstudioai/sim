import { scimConnection, scimUser } from '@sim/db/schema'
import { type AnyColumn, and, Column, eq, getTableName, is, type SQL, sql } from 'drizzle-orm'
import { ForbiddenOperationError } from '@/lib/core/application'
import type { DbOrTx } from '@/lib/db/types'
import { isScimDeploymentEnabled, isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'
import { resolveDesiredGrants } from '@/ee/scim/lib/projection/grants'
import { loadMappingRows } from '@/ee/scim/lib/projection/mapping-rows'

/**
 * Refusing membership edits that the organization's directory owns.
 *
 * When an administrator makes the directory the source of truth, a change made
 * only in Sim is undone by the next sync. Accepting it would be worse than
 * refusing: the person doing it sees success, the change disappears hours later,
 * and nothing explains why. This turns that into an error that names the
 * remedy.
 *
 * The directory owns a provisioned member's organization membership and role.
 * It owns their workspace access only where one of their groups is mapped to
 * that workspace: the grants reconciliation sets and withdraws. Access the
 * directory cannot express is left to manual sharing; refusing it would leave
 * no way to share the workspace at all.
 *
 * Deliberately not applied to deprovisioning: an administrator must always be
 * able to remove someone in an emergency, whatever the directory believes. A
 * member removing themselves is refused, since the directory would re-add them.
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
      and ${lockedSetting()}
  )`
}

function lockedSetting(): SQL {
  return sql`coalesce((${qualifiedColumn(scimConnection.settings)} ->> 'lockManualMembership')::boolean, false) = true`
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
  await refuseIfDirectoryManaged(
    params,
    'This member is managed by the organization’s identity provider. Make the change there, or turn off managed-membership locking in the organization’s directory settings.'
  )
}

/**
 * Refuses a directory-managed member leaving on their own. Unlike an
 * administrator's removal, which must always succeed, a self-leave only lasts
 * until the next sync re-adds the member, so it is refused with the remedy.
 */
export async function assertSelfLeaveNotScimManaged(params: {
  organizationId: string
  userId: string
  executor: DbOrTx
}): Promise<void> {
  await refuseIfDirectoryManaged(
    params,
    'Your membership is managed by your organization’s identity provider. Ask your identity provider administrator to remove you there.'
  )
}

async function refuseIfDirectoryManaged(
  params: { organizationId: string; userId: string; executor: DbOrTx },
  message: string
): Promise<void> {
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
  throw new ForbiddenOperationError('SCIM_MANAGED_MEMBERSHIP', message)
}

/** Refuses an invitation that would add someone the directory provisions to the organization. */
export async function assertInviteeNotScimManaged(params: {
  organizationId: string
  managed: boolean | null | undefined
}): Promise<void> {
  if (!params.managed) return
  if (!(await isScimEntitledForOrganization(params.organizationId))) return
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    'This person is provisioned by the organization’s identity provider, which manages their organization membership. Add them to the organization there.'
  )
}

/**
 * Refuses a manual change to workspace access the directory owns: access that
 * reconciliation sets and withdraws because one of the user's groups in this
 * organization's locked connection is mapped to the workspace. Derived from the
 * same mapping rows and rules reconciliation uses, so the two cannot disagree.
 */
export async function assertWorkspaceAccessNotScimManaged(params: {
  organizationId: string
  userId: string
  workspaceIds: readonly string[]
  executor: DbOrTx
}): Promise<void> {
  if (!isScimDeploymentEnabled() || params.workspaceIds.length === 0) return
  const [provisioned] = await params.executor
    .select({ scimUserId: scimUser.id })
    .from(scimUser)
    .innerJoin(scimConnection, eq(scimConnection.id, scimUser.connectionId))
    .where(
      and(
        eq(scimUser.userId, params.userId),
        eq(scimConnection.organizationId, params.organizationId),
        eq(scimConnection.status, 'active'),
        lockedSetting()
      )
    )
    .limit(1)
  if (!provisioned) return
  const requested = new Set(params.workspaceIds)
  const owned = resolveDesiredGrants(
    await loadMappingRows(params.executor, provisioned.scimUserId)
  ).some((grant) => grant.targetKind === 'workspace' && requested.has(grant.targetId))
  if (!owned) return
  /** Read only once an owned workspace is found, so the common case costs nothing. */
  if (!(await isScimEntitledForOrganization(params.organizationId, params.executor))) return
  const target = params.workspaceIds.length === 1 ? 'this workspace' : 'a selected workspace'
  throw new ForbiddenOperationError(
    'SCIM_MANAGED_MEMBERSHIP',
    `This person’s access to ${target} comes from a directory group mapped to it, so the organization’s identity provider manages it. Change their group membership there, or remove the workspace’s group mapping.`
  )
}
