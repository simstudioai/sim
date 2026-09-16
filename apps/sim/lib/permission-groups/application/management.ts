import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { definePermissionGroupManagementUseCase } from '@/lib/permission-groups/application/authorized-management-use-case'
import {
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
  PermissionGroupAllMembersConflictError,
  PermissionGroupNotFoundError,
  PermissionGroupScopeConflictError,
} from '@/lib/permission-groups/application/group-membership'
import { permissionGroupManagementOperations } from '@/lib/permission-groups/application/management-operations'
import {
  findWorkspacesNotInOrganization,
  getGroupWorkspaces,
  getWorkspacesForGroups,
  listOrganizationWorkspaces,
  loadGroupInOrganization,
} from '@/lib/permission-groups/application/management-store'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import type {
  CreatePermissionGroupSettings,
  UpdatePermissionGroupSettings,
} from '@/lib/permission-groups/management-validation'

const logger = createLogger('PermissionGroupManagement')
interface OrganizationInput {
  organizationId: string
}
interface GroupInput extends OrganizationInput {
  groupId: string
}
type CreateInput = OrganizationInput & { settings: CreatePermissionGroupSettings }
type UpdateInput = GroupInput & { settings: UpdatePermissionGroupSettings }

function serializeGroup<T extends { config: unknown; createdAt: Date; updatedAt: Date }>(group: T) {
  return {
    ...group,
    config: parsePermissionGroupConfig(group.config),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }
}

export const listPermissionGroups = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.list,
  async execute({ input }: { input: OrganizationInput }) {
    const groups = await db
      .select({
        id: permissionGroup.id,
        name: permissionGroup.name,
        description: permissionGroup.description,
        config: permissionGroup.config,
        createdBy: permissionGroup.createdBy,
        createdAt: permissionGroup.createdAt,
        updatedAt: permissionGroup.updatedAt,
        isDefault: permissionGroup.isDefault,
        creatorName: user.name,
        creatorEmail: user.email,
      })
      .from(permissionGroup)
      .leftJoin(user, eq(permissionGroup.createdBy, user.id))
      .where(eq(permissionGroup.organizationId, input.organizationId))
      .orderBy(desc(permissionGroup.createdAt))
    const groupIds = groups.map((group) => group.id)
    const counts = groupIds.length
      ? await db
          .select({ permissionGroupId: permissionGroupMember.permissionGroupId, count: count() })
          .from(permissionGroupMember)
          .where(inArray(permissionGroupMember.permissionGroupId, groupIds))
          .groupBy(permissionGroupMember.permissionGroupId)
      : []
    const countById = new Map(counts.map((row) => [row.permissionGroupId, row.count]))
    const workspaces = await getWorkspacesForGroups(groupIds)
    return {
      permissionGroups: groups.map((group) => ({
        ...serializeGroup(group),
        memberCount: countById.get(group.id) ?? 0,
        workspaces: workspaces.get(group.id) ?? [],
      })),
    }
  },
})

export const getPermissionGroup = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.get,
  async execute({ input }: { input: GroupInput }) {
    const group = await loadGroupInOrganization(input.groupId, input.organizationId)
    if (!group) throw new PermissionGroupNotFoundError()
    return {
      permissionGroup: {
        ...serializeGroup(group),
        workspaces: group.isDefault ? [] : await getGroupWorkspaces(group.id),
      },
    }
  },
})

export const listPermissionGroupWorkspaces = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.listWorkspaces,
  async execute({ input }: { input: OrganizationInput }) {
    return { workspaces: await listOrganizationWorkspaces(input.organizationId) }
  },
})

export const createPermissionGroup = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.create,
  async execute({ input, principal }: { input: CreateInput; principal: Principal }) {
    const { organizationId, settings } = input
    const isDefault = settings.isDefault === true
    const workspaceIds = isDefault ? [] : [...new Set(settings.workspaceIds ?? [])]
    if (!isDefault && !workspaceIds.length)
      throw new OrchestrationError(
        'validation',
        'Select at least one workspace when the group targets specific workspaces'
      )
    if ((await findWorkspacesNotInOrganization(workspaceIds, organizationId)).length)
      throw new OrchestrationError(
        'validation',
        'One or more selected workspaces do not belong to this organization'
      )
    const [existing] = await db
      .select({ id: permissionGroup.id })
      .from(permissionGroup)
      .where(
        and(
          eq(permissionGroup.organizationId, organizationId),
          eq(permissionGroup.name, settings.name)
        )
      )
      .limit(1)
    if (existing)
      throw new OrchestrationError('conflict', 'A permission group with this name already exists')
    const now = new Date()
    const group = {
      id: generateId(),
      organizationId,
      name: settings.name,
      description: settings.description || null,
      config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...settings.config },
      createdBy: requirePrincipalSubjectUserId(principal),
      createdAt: now,
      updatedAt: now,
      isDefault,
    }
    await db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, organizationId)
      if (!isDefault) {
        const conflict = await findAllMembersWorkspaceConflict(
          { organizationId, excludeGroupId: group.id, workspaceIds },
          tx
        )
        if (conflict) throw new PermissionGroupAllMembersConflictError(conflict)
      }
      if (isDefault)
        await tx
          .update(permissionGroup)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(permissionGroup.organizationId, organizationId),
              eq(permissionGroup.isDefault, true)
            )
          )
      await tx.insert(permissionGroup).values(group)
      if (workspaceIds.length)
        await tx.insert(permissionGroupWorkspace).values(
          workspaceIds.map((workspaceId) => ({
            id: generateId(),
            permissionGroupId: group.id,
            workspaceId,
            organizationId,
            createdAt: now,
          }))
        )
    })
    logger.info('Created permission group', {
      permissionGroupId: group.id,
      organizationId,
      userId: group.createdBy,
      workspaceCount: workspaceIds.length,
    })
    return { permissionGroup: { ...serializeGroup(group), workspaceIds } }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_CREATED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: result.permissionGroup.id,
    resourceName: result.permissionGroup.name,
    description: `Created permission group "${result.permissionGroup.name}"`,
    metadata: {
      organizationId: input.organizationId,
      isDefault: result.permissionGroup.isDefault,
      workspaceCount: result.permissionGroup.workspaceIds.length,
    },
  }),
})

export const updatePermissionGroup = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.update,
  async execute({ input }: { input: UpdateInput }) {
    const { organizationId, groupId, settings: updates } = input
    if (updates.name) {
      const [existing] = await db
        .select({ id: permissionGroup.id })
        .from(permissionGroup)
        .where(
          and(
            eq(permissionGroup.organizationId, organizationId),
            eq(permissionGroup.name, updates.name)
          )
        )
        .limit(1)
      if (existing && existing.id !== groupId)
        throw new OrchestrationError('conflict', 'A permission group with this name already exists')
    }
    if (
      updates.workspaceIds &&
      (await findWorkspacesNotInOrganization(updates.workspaceIds, organizationId)).length
    ) {
      throw new OrchestrationError(
        'validation',
        'One or more selected workspaces do not belong to this organization'
      )
    }
    return db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, organizationId)
      const current = await loadGroupInOrganization(groupId, organizationId, tx)
      if (!current) throw new PermissionGroupNotFoundError()
      const isDefault = updates.isDefault ?? current.isDefault
      if (isDefault && updates.workspaceIds !== undefined)
        throw new OrchestrationError(
          'validation',
          'The default group governs all workspaces and cannot target specific workspaces'
        )
      const demoting =
        current.isDefault && updates.isDefault === false && updates.workspaceIds === undefined
      const scopeProvided =
        demoting || updates.workspaceIds !== undefined || updates.isDefault === true
      const workspaceIds =
        isDefault || demoting
          ? []
          : updates.workspaceIds !== undefined
            ? [...new Set(updates.workspaceIds)]
            : (await getGroupWorkspaces(groupId, tx)).map((row) => row.id)
      if (scopeProvided) {
        const members = await tx
          .select({ userId: permissionGroupMember.userId })
          .from(permissionGroupMember)
          .where(eq(permissionGroupMember.permissionGroupId, groupId))
        const conflicts = await findScopeConflicts(
          {
            organizationId,
            excludeGroupId: groupId,
            workspaceIds,
            candidateUserIds: members.map((row) => row.userId),
          },
          tx
        )
        if (conflicts.length) throw new PermissionGroupScopeConflictError(conflicts)
        if (!isDefault && current.membershipMode === 'inherit' && !members.length) {
          const conflict = await findAllMembersWorkspaceConflict(
            { organizationId, excludeGroupId: groupId, workspaceIds },
            tx
          )
          if (conflict) throw new PermissionGroupAllMembersConflictError(conflict)
        }
      }
      const now = new Date()
      if (updates.isDefault === true)
        await tx
          .update(permissionGroup)
          .set({ isDefault: false, updatedAt: now })
          .where(
            and(
              eq(permissionGroup.organizationId, organizationId),
              eq(permissionGroup.isDefault, true)
            )
          )
      const [updated] = await tx
        .update(permissionGroup)
        .set({
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
          ...(updates.config !== undefined && {
            config: { ...parsePermissionGroupConfig(current.config), ...updates.config },
          }),
          updatedAt: now,
        })
        .where(
          and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId))
        )
        .returning()
      if (!updated) throw new PermissionGroupNotFoundError()
      if (scopeProvided) {
        await tx
          .delete(permissionGroupWorkspace)
          .where(eq(permissionGroupWorkspace.permissionGroupId, groupId))
        if (!isDefault && workspaceIds.length)
          await tx.insert(permissionGroupWorkspace).values(
            workspaceIds.map((workspaceId) => ({
              id: generateId(),
              permissionGroupId: groupId,
              workspaceId,
              organizationId,
              createdAt: now,
            }))
          )
      }
      return { permissionGroup: { ...serializeGroup(updated), workspaceIds } }
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_UPDATED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: input.groupId,
    resourceName: result.permissionGroup.name,
    description: `Updated permission group "${result.permissionGroup.name}"`,
    metadata: {
      organizationId: input.organizationId,
      updatedFields: Object.keys(input.settings).filter(
        (key) => input.settings[key as keyof typeof input.settings] !== undefined
      ),
    },
  }),
})

export const deletePermissionGroup = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.delete,
  async execute({ input }: { input: GroupInput }) {
    const group = await db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, input.organizationId)
      const current = await loadGroupInOrganization(input.groupId, input.organizationId, tx)
      if (!current) throw new PermissionGroupNotFoundError()
      await tx
        .delete(permissionGroupMember)
        .where(eq(permissionGroupMember.permissionGroupId, input.groupId))
      await tx
        .delete(permissionGroup)
        .where(
          and(
            eq(permissionGroup.id, input.groupId),
            eq(permissionGroup.organizationId, input.organizationId)
          )
        )
      return current
    })
    return { success: true as const, groupName: group.name }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_DELETED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: input.groupId,
    resourceName: result.groupName,
    description: `Deleted permission group "${result.groupName}"`,
    metadata: { organizationId: input.organizationId },
  }),
})
