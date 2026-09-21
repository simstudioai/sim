import { db } from '@sim/db'
import { member, permissionGroupMember, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
} from '@/lib/permission-groups/application/group-membership'
import { MAX_PERMISSION_GROUP_BULK_MEMBERS } from '@/lib/permission-groups/constants'
import {
  formatAllMembersConflictError,
  formatScopeConflictError,
} from '@/lib/permission-groups/errors'
import { requirePermissionGroup } from '@/lib/permission-groups/group-manager'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { getGroupWorkspaces } from '@/lib/permission-groups/repository'

export async function addPermissionGroupMemberRecord(
  organizationId: string,
  groupId: string,
  userId: string,
  actorUserId: string
) {
  return db.transaction(async (tx) => {
    await acquirePermissionGroupOrgLock(tx, organizationId)
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    const [organizationMember] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
    if (!organizationMember)
      throw new OrchestrationError('validation', 'User is not a member of this organization')
    const [existing] = await tx
      .select({ id: permissionGroupMember.id })
      .from(permissionGroupMember)
      .where(
        and(
          eq(permissionGroupMember.permissionGroupId, groupId),
          eq(permissionGroupMember.userId, userId)
        )
      )
      .limit(1)
    if (existing)
      throw new OrchestrationError('conflict', 'User is already in this permission group')
    const workspaceIds = (await getGroupWorkspaces(groupId, tx)).map((workspace) => workspace.id)
    const conflicts = await findScopeConflicts(
      { organizationId, excludeGroupId: groupId, workspaceIds, candidateUserIds: [userId] },
      tx
    )
    if (conflicts.length)
      throw new OrchestrationError('conflict', formatScopeConflictError(conflicts))
    const assignment = {
      id: generateId(),
      permissionGroupId: groupId,
      organizationId,
      userId,
      assignedBy: actorUserId,
      assignedAt: new Date(),
    }
    await tx.insert(permissionGroupMember).values(assignment)
    return { group, member: assignment }
  })
}

export async function removePermissionGroupMemberRecord(
  organizationId: string,
  groupId: string,
  memberId: string
) {
  return db.transaction(async (tx) => {
    await acquirePermissionGroupOrgLock(tx, organizationId)
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    const [assignment] = await tx
      .select({
        id: permissionGroupMember.id,
        userId: permissionGroupMember.userId,
        email: user.email,
      })
      .from(permissionGroupMember)
      .innerJoin(user, eq(permissionGroupMember.userId, user.id))
      .where(
        and(
          eq(permissionGroupMember.id, memberId),
          eq(permissionGroupMember.permissionGroupId, groupId)
        )
      )
      .limit(1)
    if (!assignment) throw new OrchestrationError('not_found', 'Member not found')
    if (!group.isDefault && group.membershipMode === 'inherit') {
      const [members] = await tx
        .select({ value: count() })
        .from(permissionGroupMember)
        .where(eq(permissionGroupMember.permissionGroupId, groupId))
      if ((members?.value ?? 0) <= 1) {
        const workspaceIds = (await getGroupWorkspaces(groupId, tx)).map(
          (workspace) => workspace.id
        )
        const conflict = await findAllMembersWorkspaceConflict(
          { organizationId, excludeGroupId: groupId, workspaceIds },
          tx
        )
        if (conflict)
          throw new OrchestrationError('conflict', formatAllMembersConflictError(conflict))
      }
    }
    await tx
      .delete(permissionGroupMember)
      .where(
        and(
          eq(permissionGroupMember.id, memberId),
          eq(permissionGroupMember.permissionGroupId, groupId)
        )
      )
    return { group, member: assignment }
  })
}

export interface BulkAddPermissionGroupMembersInput {
  userIds?: string[]
  addAllOrganizationMembers?: boolean
}

export async function bulkAddPermissionGroupMemberRecords(
  organizationId: string,
  groupId: string,
  input: BulkAddPermissionGroupMembersInput,
  actorUserId: string
) {
  const uniqueUserIds = [...new Set(input.userIds ?? [])]
  if (!input.addAllOrganizationMembers && uniqueUserIds.length > MAX_PERMISSION_GROUP_BULK_MEMBERS)
    throw new OrchestrationError(
      'validation',
      'userIds cannot exceed 1000; split the members into batches'
    )
  return db.transaction(async (tx) => {
    await acquirePermissionGroupOrgLock(tx, organizationId)
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    if (!input.addAllOrganizationMembers && !uniqueUserIds.length)
      return { group, addedUserIds: [] as string[], added: 0, skipped: 0 }
    const candidates = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          input.addAllOrganizationMembers ? undefined : inArray(member.userId, uniqueUserIds)
        )
      )
      .limit(MAX_PERMISSION_GROUP_BULK_MEMBERS + 1)
    if (candidates.length > MAX_PERMISSION_GROUP_BULK_MEMBERS)
      throw new OrchestrationError(
        'payload_too_large',
        'The organization has more than 1000 members; add members in batches using userIds'
      )
    const targetUserIds = [...new Set(candidates.map((candidate) => candidate.userId))]
    if (!targetUserIds.length) return { group, addedUserIds: [] as string[], added: 0, skipped: 0 }
    const workspaceIds = (await getGroupWorkspaces(groupId, tx)).map((workspace) => workspace.id)
    const conflicts = await findScopeConflicts(
      { organizationId, excludeGroupId: groupId, workspaceIds, candidateUserIds: targetUserIds },
      tx
    )
    if (conflicts.length)
      throw new OrchestrationError('conflict', formatScopeConflictError(conflicts))
    const existing = await tx
      .select({ userId: permissionGroupMember.userId })
      .from(permissionGroupMember)
      .where(
        and(
          eq(permissionGroupMember.permissionGroupId, groupId),
          inArray(permissionGroupMember.userId, targetUserIds)
        )
      )
    const existingIds = new Set(existing.map((assignment) => assignment.userId))
    const addedUserIds = targetUserIds.filter((userId) => !existingIds.has(userId))
    if (addedUserIds.length)
      await tx.insert(permissionGroupMember).values(
        addedUserIds.map((userId) => ({
          id: generateId(),
          permissionGroupId: groupId,
          organizationId,
          userId,
          assignedBy: actorUserId,
          assignedAt: new Date(),
        }))
      )
    return {
      group,
      addedUserIds,
      added: addedUserIds.length,
      skipped: targetUserIds.length - addedUserIds.length,
    }
  })
}
