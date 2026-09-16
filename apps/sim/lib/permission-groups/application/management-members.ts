import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, permissionGroupMember, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray } from 'drizzle-orm'
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
  getGroupWorkspaces,
  loadGroupInOrganization,
} from '@/lib/permission-groups/application/management-store'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import type { BulkPermissionGroupMembers } from '@/lib/permission-groups/management-validation'
import { isOrganizationMember } from '@/lib/workspaces/permissions/utils'

interface GroupInput {
  organizationId: string
  groupId: string
}
type AddInput = GroupInput & { userId: string }
type RemoveInput = GroupInput & { memberId: string }
type BulkInput = GroupInput & BulkPermissionGroupMembers

export const listPermissionGroupMembers = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.listMembers,
  async execute({ input }: { input: GroupInput }) {
    const members = await db
      .select({
        id: permissionGroupMember.id,
        userId: permissionGroupMember.userId,
        assignedAt: permissionGroupMember.assignedAt,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(permissionGroupMember)
      .leftJoin(user, eq(permissionGroupMember.userId, user.id))
      .where(eq(permissionGroupMember.permissionGroupId, input.groupId))
    return { members: members.map((row) => ({ ...row, assignedAt: row.assignedAt.toISOString() })) }
  },
})

export const addPermissionGroupMember = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.addMember,
  async execute({ input, principal }: { input: AddInput; principal: Principal }) {
    if (!(await isOrganizationMember(input.userId, input.organizationId))) {
      throw new OrchestrationError('validation', 'User is not a member of this organization')
    }
    return db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, input.organizationId)
      const group = await loadGroupInOrganization(input.groupId, input.organizationId, tx)
      if (!group) throw new PermissionGroupNotFoundError()
      const [existing] = await tx
        .select({ id: permissionGroupMember.id })
        .from(permissionGroupMember)
        .where(
          and(
            eq(permissionGroupMember.permissionGroupId, input.groupId),
            eq(permissionGroupMember.userId, input.userId)
          )
        )
        .limit(1)
      if (existing)
        throw new OrchestrationError('conflict', 'User is already in this permission group')
      const workspaceIds = (await getGroupWorkspaces(input.groupId, tx)).map((row) => row.id)
      const conflicts = await findScopeConflicts(
        {
          organizationId: input.organizationId,
          excludeGroupId: input.groupId,
          workspaceIds,
          candidateUserIds: [input.userId],
        },
        tx
      )
      if (conflicts.length) throw new PermissionGroupScopeConflictError(conflicts)
      const assignedAt = new Date()
      const row = {
        id: generateId(),
        permissionGroupId: input.groupId,
        organizationId: input.organizationId,
        userId: input.userId,
        assignedBy: requirePrincipalSubjectUserId(principal),
        assignedAt,
      }
      await tx.insert(permissionGroupMember).values(row)
      return { member: { ...row, assignedAt: assignedAt.toISOString() }, groupName: group.name }
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: input.groupId,
    resourceName: result.groupName,
    description: `Added member ${input.userId} to permission group "${result.groupName}"`,
    metadata: {
      organizationId: input.organizationId,
      targetUserId: input.userId,
      permissionGroupId: input.groupId,
    },
  }),
})

export const removePermissionGroupMember = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.removeMember,
  async execute({ input }: { input: RemoveInput }) {
    return db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, input.organizationId)
      const group = await loadGroupInOrganization(input.groupId, input.organizationId, tx)
      if (!group) throw new PermissionGroupNotFoundError()
      const [memberRow] = await tx
        .select({
          id: permissionGroupMember.id,
          userId: permissionGroupMember.userId,
          email: user.email,
        })
        .from(permissionGroupMember)
        .innerJoin(user, eq(permissionGroupMember.userId, user.id))
        .where(
          and(
            eq(permissionGroupMember.id, input.memberId),
            eq(permissionGroupMember.permissionGroupId, input.groupId)
          )
        )
        .limit(1)
      if (!memberRow) throw new OrchestrationError('not_found', 'Member not found')
      if (!group.isDefault && group.membershipMode === 'inherit') {
        const [total] = await tx
          .select({ value: count() })
          .from(permissionGroupMember)
          .where(eq(permissionGroupMember.permissionGroupId, input.groupId))
        if ((total?.value ?? 0) <= 1) {
          const workspaceIds = (await getGroupWorkspaces(input.groupId, tx)).map((row) => row.id)
          const conflict = await findAllMembersWorkspaceConflict(
            { organizationId: input.organizationId, excludeGroupId: input.groupId, workspaceIds },
            tx
          )
          if (conflict) throw new PermissionGroupAllMembersConflictError(conflict)
        }
      }
      await tx
        .delete(permissionGroupMember)
        .where(
          and(
            eq(permissionGroupMember.id, input.memberId),
            eq(permissionGroupMember.permissionGroupId, input.groupId)
          )
        )
      return {
        success: true as const,
        groupName: group.name,
        userId: memberRow.userId,
        email: memberRow.email,
      }
    })
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.PERMISSION_GROUP_MEMBER_REMOVED,
    resourceType: AuditResourceType.PERMISSION_GROUP,
    resourceId: input.groupId,
    resourceName: result.groupName,
    description: `Removed member ${result.userId} from permission group "${result.groupName}"`,
    metadata: {
      organizationId: input.organizationId,
      targetUserId: result.userId,
      targetEmail: result.email ?? undefined,
      memberId: input.memberId,
      permissionGroupId: input.groupId,
    },
  }),
})

export const bulkAddPermissionGroupMembers = definePermissionGroupManagementUseCase({
  operation: permissionGroupManagementOperations.bulkAddMembers,
  async execute({ input, principal }: { input: BulkInput; principal: Principal }) {
    let targetUserIds: string[] = []
    if (input.addAllOrganizationMembers) {
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(eq(member.organizationId, input.organizationId))
      targetUserIds = [...new Set(members.map((row) => row.userId))]
    } else if (input.userIds?.length) {
      const members = await db
        .select({ userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, input.organizationId),
            inArray(member.userId, [...new Set(input.userIds)])
          )
        )
      targetUserIds = [...new Set(members.map((row) => row.userId))]
    }
    if (!targetUserIds.length)
      return { added: 0, skipped: 0, groupName: '', addedUserIds: [] as string[] }
    const result = await db.transaction(async (tx) => {
      await acquirePermissionGroupOrgLock(tx, input.organizationId)
      const group = await loadGroupInOrganization(input.groupId, input.organizationId, tx)
      if (!group) throw new PermissionGroupNotFoundError()
      const workspaceIds = (await getGroupWorkspaces(input.groupId, tx)).map((row) => row.id)
      const conflicts = await findScopeConflicts(
        {
          organizationId: input.organizationId,
          excludeGroupId: input.groupId,
          workspaceIds,
          candidateUserIds: targetUserIds,
        },
        tx
      )
      if (conflicts.length) throw new PermissionGroupScopeConflictError(conflicts)
      const existing = await tx
        .select({ userId: permissionGroupMember.userId })
        .from(permissionGroupMember)
        .where(
          and(
            eq(permissionGroupMember.permissionGroupId, input.groupId),
            inArray(permissionGroupMember.userId, targetUserIds)
          )
        )
      const already = new Set(existing.map((row) => row.userId))
      const addedUserIds = targetUserIds.filter((id) => !already.has(id))
      if (addedUserIds.length)
        await tx.insert(permissionGroupMember).values(
          addedUserIds.map((userId) => ({
            id: generateId(),
            permissionGroupId: input.groupId,
            organizationId: input.organizationId,
            userId,
            assignedBy: requirePrincipalSubjectUserId(principal),
            assignedAt: new Date(),
          }))
        )
      return { addedUserIds, groupName: group.name }
    })
    return {
      ...result,
      added: result.addedUserIds.length,
      skipped: targetUserIds.length - result.addedUserIds.length,
    }
  },
  projectAudit: ({ input, result }) =>
    result.added
      ? {
          action: AuditAction.PERMISSION_GROUP_MEMBER_ADDED,
          resourceType: AuditResourceType.PERMISSION_GROUP,
          resourceId: input.groupId,
          resourceName: result.groupName,
          description: `Bulk added ${result.added} member(s) to permission group "${result.groupName}"`,
          metadata: {
            organizationId: input.organizationId,
            permissionGroupId: input.groupId,
            addedUserIds: result.addedUserIds,
            skipped: result.skipped,
          },
        }
      : null,
})
