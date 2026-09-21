import { member, permissionGroupMember, user } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, asc, count, eq, gt, inArray } from 'drizzle-orm'
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
import { withPermissionGroupMutation } from '@/lib/permission-groups/mutation'
import { getGroupWorkspaces } from '@/lib/permission-groups/repository'

export async function addPermissionGroupMemberRecord(
  organizationId: string,
  groupId: string,
  userId: string,
  actorUserId: string
) {
  return withPermissionGroupMutation(organizationId, async (tx) => {
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

export type PermissionGroupMemberTarget = { memberId: string } | { userId: string }

export async function removePermissionGroupMemberRecord(
  organizationId: string,
  groupId: string,
  target: PermissionGroupMemberTarget
) {
  return withPermissionGroupMutation(organizationId, async (tx) => {
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
          'memberId' in target
            ? eq(permissionGroupMember.id, target.memberId)
            : eq(permissionGroupMember.userId, target.userId),
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
          eq(permissionGroupMember.id, assignment.id),
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
  if (
    input.addAllOrganizationMembers === true ? input.userIds !== undefined : !input.userIds?.length
  )
    throw new OrchestrationError(
      'validation',
      'Provide userIds or set addAllOrganizationMembers to true, but not both'
    )
  return withPermissionGroupMutation(organizationId, async (tx) => {
    const group = await requirePermissionGroup(organizationId, groupId, tx)
    const workspaceIds = (await getGroupWorkspaces(groupId, tx)).map((workspace) => workspace.id)
    const addedUserIds: string[] = []
    let added = 0
    let skipped = 0

    async function addBatch(targetUserIds: string[]) {
      if (!targetUserIds.length) return
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
      const batch = targetUserIds.filter((userId) => !existingIds.has(userId))
      if (batch.length)
        await tx.insert(permissionGroupMember).values(
          batch.map((userId) => ({
            id: generateId(),
            permissionGroupId: groupId,
            organizationId,
            userId,
            assignedBy: actorUserId,
            assignedAt: new Date(),
          }))
        )
      added += batch.length
      skipped += targetUserIds.length - batch.length
      addedUserIds.push(...batch.slice(0, MAX_PERMISSION_GROUP_BULK_MEMBERS - addedUserIds.length))
    }

    if (input.addAllOrganizationMembers) {
      let afterUserId: string | undefined
      while (true) {
        const candidates = await tx
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              afterUserId === undefined ? undefined : gt(member.userId, afterUserId)
            )
          )
          .orderBy(asc(member.userId))
          .limit(MAX_PERMISSION_GROUP_BULK_MEMBERS)
        await addBatch(candidates.map((candidate) => candidate.userId))
        if (candidates.length < MAX_PERMISSION_GROUP_BULK_MEMBERS) break
        afterUserId = candidates[candidates.length - 1].userId
      }
    } else {
      for (const selected of chunkArray(
        [...new Set(input.userIds ?? [])],
        MAX_PERMISSION_GROUP_BULK_MEMBERS
      )) {
        const candidates = await tx
          .select({ userId: member.userId })
          .from(member)
          .where(and(eq(member.organizationId, organizationId), inArray(member.userId, selected)))
        await addBatch(candidates.map((candidate) => candidate.userId))
      }
    }
    return { group, addedUserIds, added, skipped }
  })
}
