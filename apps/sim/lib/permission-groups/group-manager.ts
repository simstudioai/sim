import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
} from '@/lib/permission-groups/application/group-membership'
import {
  formatAllMembersConflictError,
  formatScopeConflictError,
} from '@/lib/permission-groups/errors'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import { withPermissionGroupMutation } from '@/lib/permission-groups/mutation'
import {
  findWorkspacesNotInOrganization,
  getGroupWorkspaces,
  loadGroupInOrganization,
} from '@/lib/permission-groups/repository'

export interface PermissionGroupChanges {
  name?: string
  description?: string | null
  config?: Partial<PermissionGroupConfig>
  isDefault?: boolean
  workspaceIds?: string[]
}

export async function requirePermissionGroup(
  organizationId: string,
  groupId: string,
  executor: DbOrTx = db
) {
  const group = await loadGroupInOrganization(groupId, organizationId, executor)
  if (!group) throw new OrchestrationError('not_found', 'Permission group not found')
  return group
}

async function validateWorkspaces(
  organizationId: string,
  workspaceIds: string[],
  executor: DbOrTx
) {
  if ((await findWorkspacesNotInOrganization(workspaceIds, organizationId, executor)).length)
    throw new OrchestrationError(
      'validation',
      'One or more selected workspaces do not belong to this organization'
    )
}

async function assertAvailableName(
  organizationId: string,
  name: string,
  executor: DbOrTx,
  groupId?: string
) {
  const [existing] = await executor
    .select({ id: permissionGroup.id })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.name, name)))
    .limit(1)
  if (existing && existing.id !== groupId)
    throw new OrchestrationError('conflict', 'A permission group with this name already exists')
}

async function demoteDefault(organizationId: string, now: Date, tx: DbOrTx) {
  await tx
    .update(permissionGroup)
    .set({ isDefault: false, updatedAt: now })
    .where(
      and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, true))
    )
}

async function insertWorkspaceLinks(
  organizationId: string,
  groupId: string,
  workspaceIds: string[],
  now: Date,
  tx: DbOrTx
) {
  if (workspaceIds.length)
    await tx.insert(permissionGroupWorkspace).values(
      workspaceIds.map((workspaceId) => ({
        id: generateId(),
        permissionGroupId: groupId,
        organizationId,
        workspaceId,
        createdAt: now,
      }))
    )
}

export async function createPermissionGroupRecord(
  organizationId: string,
  actorUserId: string,
  input: PermissionGroupChanges & { name: string }
) {
  const isDefault = input.isDefault === true
  const workspaceIds = [...new Set(input.workspaceIds ?? [])]
  if (isDefault && workspaceIds.length)
    throw new OrchestrationError(
      'validation',
      'The default group governs all workspaces and cannot target specific workspaces'
    )
  if (!isDefault && !workspaceIds.length)
    throw new OrchestrationError(
      'validation',
      'Select at least one workspace when the group targets specific workspaces'
    )
  return withPermissionGroupMutation(organizationId, async (tx) => {
    await validateWorkspaces(organizationId, workspaceIds, tx)
    await assertAvailableName(organizationId, input.name, tx)
    const now = new Date()
    const group = {
      id: generateId(),
      organizationId,
      name: input.name,
      description: input.description || null,
      config: { ...DEFAULT_PERMISSION_GROUP_CONFIG, ...input.config },
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
      isDefault,
      membershipMode: 'inherit',
    }
    if (!isDefault) {
      const conflict = await findAllMembersWorkspaceConflict(
        { organizationId, excludeGroupId: group.id, workspaceIds },
        tx
      )
      if (conflict)
        throw new OrchestrationError('conflict', formatAllMembersConflictError(conflict))
    }
    if (isDefault) await demoteDefault(organizationId, now, tx)
    await tx.insert(permissionGroup).values(group)
    await insertWorkspaceLinks(organizationId, group.id, workspaceIds, now, tx)
    return { ...group, workspaceIds }
  })
}

export async function updatePermissionGroupRecord(
  organizationId: string,
  groupId: string,
  updates: PermissionGroupChanges
) {
  return withPermissionGroupMutation(organizationId, async (tx) => {
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    if (updates.name !== undefined)
      await assertAvailableName(organizationId, updates.name, tx, groupId)
    const isDefault = updates.isDefault ?? group.isDefault
    if (isDefault && updates.workspaceIds?.length)
      throw new OrchestrationError(
        'validation',
        'The default group governs all workspaces and cannot target specific workspaces'
      )
    const demotingToInert =
      group.isDefault && updates.isDefault === false && updates.workspaceIds === undefined
    const scopeProvided =
      demotingToInert || updates.workspaceIds !== undefined || updates.isDefault === true
    const workspaceIds =
      isDefault || demotingToInert
        ? []
        : updates.workspaceIds !== undefined
          ? [...new Set(updates.workspaceIds)]
          : (await getGroupWorkspaces(groupId, tx)).map((workspace) => workspace.id)
    if (updates.workspaceIds !== undefined)
      await validateWorkspaces(organizationId, workspaceIds, tx)
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
          candidateUserIds: members.map((member) => member.userId),
        },
        tx
      )
      if (conflicts.length)
        throw new OrchestrationError('conflict', formatScopeConflictError(conflicts))
      if (!isDefault && group.membershipMode === 'inherit' && members.length === 0) {
        const conflict = await findAllMembersWorkspaceConflict(
          { organizationId, excludeGroupId: groupId, workspaceIds },
          tx
        )
        if (conflict)
          throw new OrchestrationError('conflict', formatAllMembersConflictError(conflict))
      }
    }
    const now = new Date()
    if (updates.isDefault === true) await demoteDefault(organizationId, now, tx)
    const config = updates.config
      ? { ...parsePermissionGroupConfig(group.config), ...updates.config }
      : parsePermissionGroupConfig(group.config)
    const [updated] = await tx
      .update(permissionGroup)
      .set({
        ...(updates.name !== undefined && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
        ...(updates.config !== undefined && { config }),
        updatedAt: now,
      })
      .where(
        and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId))
      )
      .returning()
    if (!updated) throw new OrchestrationError('not_found', 'Permission group not found')
    if (scopeProvided) {
      await tx
        .delete(permissionGroupWorkspace)
        .where(eq(permissionGroupWorkspace.permissionGroupId, groupId))
      await insertWorkspaceLinks(organizationId, groupId, workspaceIds, now, tx)
    }
    return { ...updated, config: parsePermissionGroupConfig(updated.config), workspaceIds }
  })
}

export async function deletePermissionGroupRecord(organizationId: string, groupId: string) {
  return withPermissionGroupMutation(organizationId, async (tx) => {
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    await tx
      .delete(permissionGroupMember)
      .where(eq(permissionGroupMember.permissionGroupId, groupId))
    await tx
      .delete(permissionGroup)
      .where(
        and(eq(permissionGroup.id, groupId), eq(permissionGroup.organizationId, organizationId))
      )
    return group
  })
}
