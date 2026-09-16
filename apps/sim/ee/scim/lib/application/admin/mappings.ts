import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  permissionGroup,
  type ScimConnectionSettings,
  scimConnection,
  scimGroup,
  scimGroupMapping,
  scimGroupMember,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, sql } from 'drizzle-orm'
import type { ScimGroupMappingView } from '@/lib/api/contracts/organization-scim'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import {
  assertWorkspaceInOrganization,
  requireConnection,
} from '@/ee/scim/lib/application/admin/connection-view'
import {
  defineAuthorizedScimAdminUseCase,
  type ScimAdminUseCaseArgs,
} from '@/ee/scim/lib/application/authorized-scim-admin-use-case'
import { scimAdminOperations } from '@/ee/scim/lib/application/operations'
import { reconcileUsersProjectionInBatches } from '@/ee/scim/lib/projection/reconcile-user'

/**
 * Mapping directory groups onto Sim access.
 *
 * A pushed group means nothing until an administrator says what it stands for:
 * a permission group, a workspace at a level, or the organization admin role.
 * Changing a mapping re-projects every member of the group at once, so the
 * change takes effect without waiting for the directory's next cycle.
 */

const MAPPING_COLUMNS = {
  id: scimGroupMapping.id,
  groupId: scimGroupMapping.groupId,
  targetKind: scimGroupMapping.targetKind,
  permissionGroupId: scimGroupMapping.permissionGroupId,
  workspaceId: scimGroupMapping.workspaceId,
  permissionType: scimGroupMapping.permissionType,
  role: scimGroupMapping.role,
} as const

function toMappingView(row: {
  id: string
  groupId: string
  groupDisplayName: string
  targetKind: string
  permissionGroupId: string | null
  workspaceId: string | null
  permissionType: 'admin' | 'write' | 'read' | null
  role: string | null
}): ScimGroupMappingView {
  return {
    id: row.id,
    groupId: row.groupId,
    groupDisplayName: row.groupDisplayName,
    targetKind: row.targetKind as ScimGroupMappingView['targetKind'],
    permissionGroupId: row.permissionGroupId,
    workspaceId: row.workspaceId,
    permissionType: row.permissionType,
    role: row.role,
  }
}

export const listScimGroupMappings = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.read,
  async execute({ input }: ScimAdminUseCaseArgs<{ organizationId: string }>) {
    const [connection] = await db
      .select({ id: scimConnection.id })
      .from(scimConnection)
      .where(eq(scimConnection.organizationId, input.organizationId))
      .limit(1)
    if (!connection) return { groups: [] }

    const [groups, mappings, counts] = await Promise.all([
      db
        .select({ id: scimGroup.id, displayName: scimGroup.displayName })
        .from(scimGroup)
        .where(eq(scimGroup.connectionId, connection.id))
        .orderBy(scimGroup.displayName),
      db
        .select({ ...MAPPING_COLUMNS, groupDisplayName: scimGroup.displayName })
        .from(scimGroupMapping)
        .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMapping.groupId))
        .where(eq(scimGroup.connectionId, connection.id)),
      db
        .select({ groupId: scimGroupMember.groupId, value: count() })
        .from(scimGroupMember)
        .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMember.groupId))
        .where(eq(scimGroup.connectionId, connection.id))
        .groupBy(scimGroupMember.groupId),
    ])

    const memberCounts = new Map(counts.map((row) => [row.groupId, Number(row.value)]))
    const mappingsByGroup = new Map<string, ScimGroupMappingView[]>()
    for (const row of mappings) {
      const list = mappingsByGroup.get(row.groupId) ?? []
      list.push(toMappingView(row))
      mappingsByGroup.set(row.groupId, list)
    }

    return {
      groups: groups.map((group) => ({
        id: group.id,
        displayName: group.displayName,
        memberCount: memberCounts.get(group.id) ?? 0,
        mappings: mappingsByGroup.get(group.id) ?? [],
      })),
    }
  },
})

/** Re-runs the projection for every member of a group whose mapping changed. */
async function reconcileGroupMembers(params: {
  connectionId: string
  organizationId: string
  groupId: string
  settings: ScimConnectionSettings
}): Promise<number> {
  const members = await db
    .select({ scimUserId: scimGroupMember.scimUserId })
    .from(scimGroupMember)
    .where(eq(scimGroupMember.groupId, params.groupId))

  await reconcileUsersProjectionInBatches({
    connectionId: params.connectionId,
    organizationId: params.organizationId,
    scimUserIds: members.map((row) => row.scimUserId),
    settings: params.settings,
  })
  return members.length
}

async function requireGroup(connectionId: string, groupId: string) {
  const [group] = await db
    .select({ id: scimGroup.id, displayName: scimGroup.displayName })
    .from(scimGroup)
    .where(and(eq(scimGroup.id, groupId), eq(scimGroup.connectionId, connectionId)))
    .limit(1)
  if (!group) throw new OrchestrationError('not_found', 'Directory group not found')
  return group
}

async function assertPermissionGroupTarget(
  tx: DbOrTx,
  organizationId: string,
  permissionGroupId: string
) {
  const [target] = await tx
    .select({
      id: permissionGroup.id,
      membershipMode: permissionGroup.membershipMode,
      isDefault: permissionGroup.isDefault,
    })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.id, permissionGroupId),
        eq(permissionGroup.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!target) {
    throw new OrchestrationError(
      'not_found',
      'That permission group does not belong to this organization'
    )
  }
  /** The default group governs by not having members; a membership mapping onto it would do nothing. */
  if (target.isDefault) {
    throw new OrchestrationError(
      'validation',
      'The organization default permission group cannot be a mapping target'
    )
  }
  /**
   * A directory-managed group must govern exactly its members. Left in
   * `inherit` mode, the directory removing the last person would widen it
   * from "these people" to "everyone in these workspaces".
   */
  if (target.membershipMode !== 'explicit') {
    await acquirePermissionGroupOrgLock(tx, organizationId, { lockTimeoutAlreadyBounded: true })
    await tx
      .update(permissionGroup)
      .set({ membershipMode: 'explicit', updatedAt: new Date() })
      .where(eq(permissionGroup.id, target.id))
  }
}

export type UpsertScimGroupMappingInput = { organizationId: string } & (
  | { targetKind: 'permission_group'; groupId: string; permissionGroupId: string }
  | {
      targetKind: 'workspace'
      groupId: string
      workspaceId: string
      permissionType: 'admin' | 'write' | 'read'
    }
  | { targetKind: 'org_role'; groupId: string; role: 'admin' }
)

export const upsertScimGroupMapping = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.upsertMapping,
  async execute({ input, context }: ScimAdminUseCaseArgs<UpsertScimGroupMappingInput>) {
    const connection = await requireConnection(context.organizationId)
    const group = await requireGroup(connection.id, input.groupId)
    if (input.targetKind === 'workspace') {
      await assertWorkspaceInOrganization(context.organizationId, input.workspaceId)
    }

    const values = {
      id: generateId(),
      groupId: group.id,
      targetKind: input.targetKind,
      permissionGroupId: input.targetKind === 'permission_group' ? input.permissionGroupId : null,
      workspaceId: input.targetKind === 'workspace' ? input.workspaceId : null,
      permissionType: input.targetKind === 'workspace' ? input.permissionType : null,
      role: input.targetKind === 'org_role' ? input.role : null,
      source: 'manual',
      createdBy: context.actorUserId,
    }

    /**
     * The target check, the insert, and the fallback update commit together, so
     * a refused insert cannot leave a permission group switched to explicit
     * mode with no mapping. The uniqueness index is on a `coalesce` of the three
     * target columns — an expression, not a column list — so it cannot be named
     * as a conflict target; a concurrent insert of the same pair loses on the
     * index and the row that won is updated instead.
     */
    const targetId = values.permissionGroupId ?? values.workspaceId ?? values.role
    const mapping = await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, context.organizationId)
      if (input.targetKind === 'permission_group') {
        await assertPermissionGroupTarget(tx, context.organizationId, input.permissionGroupId)
      }
      const [inserted] = await tx
        .insert(scimGroupMapping)
        .values(values)
        .onConflictDoNothing()
        .returning(MAPPING_COLUMNS)
      if (inserted) return inserted

      /** An administrator re-mapping a pair the directory matched by name takes ownership of it. */
      const [updated] = await tx
        .update(scimGroupMapping)
        .set({
          permissionType: values.permissionType,
          source: 'manual',
          createdBy: context.actorUserId,
        })
        .where(
          and(
            eq(scimGroupMapping.groupId, group.id),
            eq(scimGroupMapping.targetKind, input.targetKind),
            sql`coalesce(${scimGroupMapping.permissionGroupId}, ${scimGroupMapping.workspaceId}, ${scimGroupMapping.role}) = ${targetId}`
          )
        )
        .returning(MAPPING_COLUMNS)
      if (!updated) throw new OrchestrationError('internal', 'The mapping could not be written')
      return updated
    })

    const reconciledUsers = await reconcileGroupMembers({
      connectionId: connection.id,
      organizationId: context.organizationId,
      groupId: group.id,
      settings: connection.settings,
    })

    return {
      mapping: toMappingView({ ...mapping, groupDisplayName: group.displayName }),
      reconciledUsers,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_GROUP_MAPPING_UPSERTED,
    resourceType: AuditResourceType.SCIM_GROUP,
    resourceId: result.mapping.groupId,
    resourceName: result.mapping.groupDisplayName,
    metadata: { targetKind: result.mapping.targetKind, mappingId: result.mapping.id },
  }),
})

export const deleteScimGroupMapping = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.deleteMapping,
  async execute({
    input,
    context,
  }: ScimAdminUseCaseArgs<{ organizationId: string; mappingId: string }>) {
    const connection = await requireConnection(context.organizationId)

    const [mapping] = await db
      .select({ id: scimGroupMapping.id, groupId: scimGroupMapping.groupId })
      .from(scimGroupMapping)
      .innerJoin(scimGroup, eq(scimGroup.id, scimGroupMapping.groupId))
      .where(
        and(eq(scimGroupMapping.id, input.mappingId), eq(scimGroup.connectionId, connection.id))
      )
      .limit(1)
    if (!mapping) throw new OrchestrationError('not_found', 'Mapping not found')

    await db.delete(scimGroupMapping).where(eq(scimGroupMapping.id, mapping.id))

    const reconciledUsers = await reconcileGroupMembers({
      connectionId: connection.id,
      organizationId: context.organizationId,
      groupId: mapping.groupId,
      settings: connection.settings,
    })

    return { success: true as const, reconciledUsers, mapping }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_GROUP_MAPPING_DELETED,
    resourceType: AuditResourceType.SCIM_GROUP,
    resourceId: result.mapping.groupId,
    metadata: { mappingId: result.mapping.id },
  }),
})
