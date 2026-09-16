import {
  member,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  workspace,
} from '@sim/db/schema'
import { and, count, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { AccessRequestImpact } from '@/lib/permission-access-requests/types'

/** Order-independent change detector with fixed-size aggregate state instead of sorted row strings. */
function membershipRevision(value: SQL): SQL<string> {
  return sql<string>`count(*)::text || ':' ||
    coalesce(sum(('x' || substr(md5(${value}), 1, 16))::bit(64)::bigint::numeric), 0)::text || ':' ||
    coalesce(sum(('x' || substr(md5(${value}), 17, 16))::bit(64)::bigint::numeric), 0)::text`
}

/** Counts a conservative audience on the database and returns at most 100 workspace names. */
export async function loadAccessRequestGroupImpact(
  executor: DbOrTx,
  organizationId: string,
  groupId: string
): Promise<{ impact: AccessRequestImpact; revision: string }> {
  const [group] = await executor
    .select({ isDefault: permissionGroup.isDefault, updatedAt: permissionGroup.updatedAt })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId)))
    .limit(1)
  const scope = and(
    eq(workspace.organizationId, organizationId),
    isNull(workspace.archivedAt),
    group?.isDefault
      ? undefined
      : sql`exists (select 1 from ${permissionGroupWorkspace} where ${permissionGroupWorkspace.permissionGroupId} = ${groupId} and ${permissionGroupWorkspace.workspaceId} = ${workspace.id})`
  )
  const scopedWorkspaces = executor.select({ id: workspace.id }).from(workspace).where(scope)
  const scopedGrantees = executor
    .select({ userId: permissions.userId })
    .from(permissions)
    .where(
      and(eq(permissions.entityType, 'workspace'), inArray(permissions.entityId, scopedWorkspaces))
    )
  /** Competing groups in the same workspaces can change explicit/inherited group precedence. */
  const relevantGroups = executor
    .select({ id: permissionGroup.id })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.organizationId, organizationId),
        or(
          eq(permissionGroup.id, groupId),
          inArray(
            permissionGroup.id,
            executor
              .select({ groupId: permissionGroupWorkspace.permissionGroupId })
              .from(permissionGroupWorkspace)
              .where(inArray(permissionGroupWorkspace.workspaceId, scopedWorkspaces))
          )
        )
      )
    )
  const names = await executor
    .select({ name: workspace.name })
    .from(workspace)
    .where(scope)
    .orderBy(workspace.name, workspace.id)
    .limit(100)
  const [workspaces] = await executor
    .select({
      total: count(),
      revision: membershipRevision(
        sql`jsonb_build_array(${workspace.id}, ${workspace.name})::text`
      ),
    })
    .from(workspace)
    .where(scope)
  const [grants] = await executor
    .select({
      revision: membershipRevision(
        sql`jsonb_build_array(${permissions.id}, ${permissions.userId}, ${permissions.entityId}, ${permissions.permissionType}, ${permissions.updatedAt})::text`
      ),
    })
    .from(permissions)
    .innerJoin(
      workspace,
      and(eq(workspace.id, permissions.entityId), eq(permissions.entityType, 'workspace'))
    )
    .where(scope)
  const [orgMembers] = await executor
    .select({
      revision: membershipRevision(
        sql`jsonb_build_array(${member.id}, ${member.userId}, ${member.role})::text`
      ),
    })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        group?.isDefault
          ? undefined
          : or(inArray(member.role, ['admin', 'owner']), inArray(member.userId, scopedGrantees))
      )
    )
  const [assignments] = await executor
    .select({
      revision: membershipRevision(
        sql`jsonb_build_array(${permissionGroupMember.id}, ${permissionGroupMember.userId}, ${permissionGroupMember.permissionGroupId})::text`
      ),
    })
    .from(permissionGroupMember)
    .where(
      and(
        eq(permissionGroupMember.organizationId, organizationId),
        inArray(permissionGroupMember.permissionGroupId, relevantGroups)
      )
    )
  const [scopes] = await executor
    .select({
      revision: membershipRevision(
        sql`jsonb_build_array(${permissionGroupWorkspace.id}, ${permissionGroupWorkspace.workspaceId}, ${permissionGroupWorkspace.permissionGroupId})::text`
      ),
    })
    .from(permissionGroupWorkspace)
    .where(
      and(
        eq(permissionGroupWorkspace.organizationId, organizationId),
        inArray(permissionGroupWorkspace.workspaceId, scopedWorkspaces)
      )
    )
  const candidates = executor
    .select({ userId: permissions.userId })
    .from(permissions)
    .innerJoin(
      workspace,
      and(eq(workspace.id, permissions.entityId), eq(permissions.entityType, 'workspace'))
    )
    .where(scope)
    .union(
      executor
        .select({ userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            group?.isDefault ? undefined : inArray(member.role, ['admin', 'owner'])
          )
        )
    )
    .as('affected_people')
  const [people] = await executor.select({ total: count() }).from(candidates)
  const [groupVersions] = await executor
    .select({
      revision: membershipRevision(
        sql`jsonb_build_array(${permissionGroup.id}, ${permissionGroup.createdAt}, ${permissionGroup.membershipMode}, ${permissionGroup.isDefault})::text`
      ),
    })
    .from(permissionGroup)
    .where(inArray(permissionGroup.id, relevantGroups))
  return {
    impact: {
      memberCount: Number(people?.total ?? 0),
      workspaceCount: workspaces?.total ?? 0,
      workspaceNames: names.map((row) => row.name),
      truncated: (workspaces?.total ?? 0) > names.length,
    },
    revision: JSON.stringify([
      group?.updatedAt,
      workspaces?.revision,
      grants?.revision,
      orgMembers?.revision,
      groupVersions?.revision,
      assignments?.revision,
      scopes?.revision,
    ]),
  }
}
