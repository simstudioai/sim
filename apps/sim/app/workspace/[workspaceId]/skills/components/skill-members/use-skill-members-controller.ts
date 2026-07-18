'use client'

import { useCallback, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import type { AddPeopleTarget, MemberRole } from '@/components/permissions'
import { skillRoleLockReason } from '@/components/permissions'
import type { SkillMember } from '@/lib/api/contracts'
import { useRemoveSkillMember, useSkillMembers, useUpsertSkillMember } from '@/hooks/queries/skills'

const logger = createLogger('SkillMembersController')

const LAST_ADMIN_LOCK_REASON = 'The last admin of a restricted skill cannot be demoted or removed'

/**
 * Why a member row's controls are locked, or null when editable. Combines the
 * derived workspace-admin lock with the restricted-skill last-explicit-admin
 * lock (the server enforces both; this mirrors them client-side).
 */
export function skillMemberLockReason(
  member: SkillMember,
  context: { workspaceShared: boolean; explicitAdminCount: number }
): string | null {
  const derived = skillRoleLockReason(member.roleSource)
  if (derived) return derived
  const lastAdminLocked =
    !context.workspaceShared &&
    member.role === 'admin' &&
    member.roleSource === 'explicit' &&
    context.explicitAdminCount <= 1
  return lastAdminLocked ? LAST_ADMIN_LOCK_REASON : null
}

export interface SkillMembersController {
  activeMembers: SkillMember[]
  removedMembers: SkillMember[]
  membersLoading: boolean
  membersError: boolean
  explicitAdminCount: number
  /** Lowercased emails already holding access — feeds the Add People modal. */
  existingMemberEmails: Set<string>
  changeMemberRole: (userId: string, role: MemberRole) => Promise<void>
  removeMember: (userId: string) => Promise<void>
  restoreMember: (userId: string) => Promise<void>
  addMember: (target: AddPeopleTarget, role: MemberRole) => Promise<unknown>
}

interface UseSkillMembersControllerParams {
  skillId: string
  workspaceId: string
}

/**
 * Data + mutation controller behind every skill member surface (the modal's
 * Members tab and the skill detail page): partitions the roster into active and
 * removed (denied) members, exposes the add/role-change/remove/restore actions,
 * and the derived counts the lock rules need. Renderers own only chrome.
 */
export function useSkillMembersController({
  skillId,
  workspaceId,
}: UseSkillMembersControllerParams): SkillMembersController {
  const {
    data: members = [],
    isPending: membersLoading,
    isError: membersError,
  } = useSkillMembers(skillId)
  const { mutateAsync: upsertMemberAsync } = useUpsertSkillMember()
  const { mutateAsync: removeMemberAsync } = useRemoveSkillMember()

  const { activeMembers, removedMembers } = useMemo(() => {
    const active: SkillMember[] = []
    const removed: SkillMember[] = []
    for (const member of members) {
      ;(member.status === 'revoked' ? removed : active).push(member)
    }
    return { activeMembers: active, removedMembers: removed }
  }, [members])

  const explicitAdminCount = useMemo(
    () =>
      activeMembers.filter((member) => member.role === 'admin' && member.roleSource === 'explicit')
        .length,
    [activeMembers]
  )

  const existingMemberEmails = useMemo(
    () =>
      new Set(
        activeMembers
          .filter((member) => member.roleSource !== 'workspace')
          .map((member) => (member.userEmail ?? '').toLowerCase())
          .filter(Boolean)
      ),
    [activeMembers]
  )

  const changeMemberRole = useCallback(
    async (userId: string, role: MemberRole) => {
      const current = activeMembers.find((member) => member.userId === userId)
      if (current?.role === role) return
      try {
        await upsertMemberAsync({ skillId, workspaceId, userId, role })
      } catch (error) {
        logger.error('Failed to change skill member role', error)
      }
    },
    [activeMembers, upsertMemberAsync, skillId, workspaceId]
  )

  const removeMember = useCallback(
    async (userId: string) => {
      try {
        await removeMemberAsync({ skillId, workspaceId, userId })
      } catch (error) {
        logger.error('Failed to remove skill member', error)
      }
    },
    [removeMemberAsync, skillId, workspaceId]
  )

  const restoreMember = useCallback(
    async (userId: string) => {
      try {
        await upsertMemberAsync({ skillId, workspaceId, userId, role: 'member' })
      } catch (error) {
        logger.error('Failed to restore skill member', error)
      }
    },
    [upsertMemberAsync, skillId, workspaceId]
  )

  const addMember = useCallback(
    (target: AddPeopleTarget, role: MemberRole) =>
      upsertMemberAsync({ skillId, workspaceId, userId: target.userId, role }),
    [upsertMemberAsync, skillId, workspaceId]
  )

  return {
    activeMembers,
    removedMembers,
    membersLoading,
    membersError,
    explicitAdminCount,
    existingMemberEmails,
    changeMemberRole,
    removeMember,
    restoreMember,
    addMember,
  }
}
