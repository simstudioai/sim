'use client'

import { useCallback, useMemo, useState } from 'react'
import { Chip, ChipModalField, ChipSwitch } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import {
  AddPeopleModal,
  type AddPeopleTarget,
  type MemberRole,
  MemberRow,
  skillRoleLockReason,
} from '@/components/permissions'
import {
  useRemoveSkillMember,
  useSkillMembers,
  useUpdateSkill,
  useUpsertSkillMember,
} from '@/hooks/queries/skills'

const logger = createLogger('SkillMembers')

export const ACCESS_OPTIONS = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'restricted', label: 'Restricted' },
] as const

export type SkillAccessValue = (typeof ACCESS_OPTIONS)[number]['value']

const LAST_ADMIN_LOCK_REASON =
  'The last admin of a restricted skill cannot be demoted or removed'

interface SkillMembersSectionProps {
  skillId: string
  workspaceId: string
  /** Whether the viewer is a skill admin (explicit or derived workspace admin). */
  isAdmin: boolean
  workspaceShared: boolean
}

/**
 * Members tab for a skill: the workspace-sharing switch, the member list
 * (explicit members, derived workspace admins, and implicit workspace-shared
 * members), removed (denied) members with a restore action, and an add-people
 * flow. Mutations are admin-only; non-admin members see the list read-only.
 */
export function SkillMembersSection({
  skillId,
  workspaceId,
  isAdmin,
  workspaceShared,
}: SkillMembersSectionProps) {
  const {
    data: members = [],
    isPending: membersLoading,
    isError: membersError,
  } = useSkillMembers(skillId)
  const { mutateAsync: upsertMemberAsync } = useUpsertSkillMember()
  const { mutateAsync: removeMemberAsync } = useRemoveSkillMember()
  const updateSkill = useUpdateSkill()

  const [addOpen, setAddOpen] = useState(false)

  const { activeMembers, removedMembers } = useMemo(() => {
    const active: typeof members = []
    const removed: typeof members = []
    for (const member of members) {
      ;(member.status === 'revoked' ? removed : active).push(member)
    }
    return { activeMembers: active, removedMembers: removed }
  }, [members])

  const explicitAdminCount = activeMembers.filter(
    (member) => member.role === 'admin' && member.roleSource === 'explicit'
  ).length

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

  const handleAccessChange = (value: SkillAccessValue) => {
    const next = value === 'workspace'
    if (next === workspaceShared || updateSkill.isPending) return
    updateSkill.mutate({ workspaceId, skillId, updates: { workspaceShared: next } })
  }

  const handleChangeMemberRole = async (userId: string, role: MemberRole) => {
    const current = activeMembers.find((member) => member.userId === userId)
    if (current?.role === role) return
    try {
      await upsertMemberAsync({ skillId, workspaceId, userId, role })
    } catch (error) {
      logger.error('Failed to change skill member role', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMemberAsync({ skillId, workspaceId, userId })
    } catch (error) {
      logger.error('Failed to remove skill member', error)
    }
  }

  const handleRestoreMember = async (userId: string) => {
    try {
      await upsertMemberAsync({ skillId, workspaceId, userId, role: 'member' })
    } catch (error) {
      logger.error('Failed to restore skill member', error)
    }
  }

  const addMember = useCallback(
    (target: AddPeopleTarget, role: MemberRole) =>
      upsertMemberAsync({ skillId, workspaceId, userId: target.userId, role }),
    [upsertMemberAsync, skillId, workspaceId]
  )

  return (
    <>
      <ChipModalField
        type='custom'
        title='Access'
        hint={
          workspaceShared
            ? 'Everyone in the workspace can use this skill.'
            : 'Only the members below and workspace admins can use this skill.'
        }
      >
        {isAdmin ? (
          <ChipSwitch
            aria-label='Skill access'
            options={ACCESS_OPTIONS}
            value={workspaceShared ? 'workspace' : 'restricted'}
            onChange={handleAccessChange}
          />
        ) : (
          <span className='text-[14px] text-[var(--text-body)]'>
            {workspaceShared ? 'Workspace' : 'Restricted'}
          </span>
        )}
      </ChipModalField>

      <ChipModalField type='custom' title={`Members (${activeMembers.length})`}>
        {membersError ? (
          <span className='text-[12px] text-[var(--text-muted)]'>
            Couldn't load members. You may no longer have access to this skill.
          </span>
        ) : (
          <div className='flex flex-col gap-2'>
            {isAdmin && (
              <Chip onClick={() => setAddOpen(true)} className='self-start'>
                Add people
              </Chip>
            )}
            {membersLoading
              ? null
              : activeMembers.map((member) => {
                  const lastAdminLocked =
                    !workspaceShared &&
                    member.role === 'admin' &&
                    member.roleSource === 'explicit' &&
                    explicitAdminCount <= 1
                  const lockReason =
                    skillRoleLockReason(member.roleSource) ??
                    (lastAdminLocked ? LAST_ADMIN_LOCK_REASON : null)
                  return (
                    <MemberRow
                      key={member.id}
                      member={member}
                      lockReason={lockReason}
                      canManage={isAdmin}
                      roleDisabled={!isAdmin || lockReason !== null}
                      removeDisabled={lockReason !== null}
                      onRoleChange={(role) => handleChangeMemberRole(member.userId, role)}
                      onRemove={() => handleRemoveMember(member.userId)}
                    />
                  )
                })}
          </div>
        )}
      </ChipModalField>

      {isAdmin && removedMembers.length > 0 && (
        <ChipModalField type='custom' title={`Removed (${removedMembers.length})`}>
          <div className='flex flex-col gap-2'>
            {removedMembers.map((member) => (
              <div key={member.id} className='flex items-center justify-between gap-2'>
                <span className='min-w-0 truncate text-[14px] text-[var(--text-muted)]'>
                  {member.userName || member.userEmail || member.userId}
                </span>
                <Chip onClick={() => handleRestoreMember(member.userId)} flush>
                  Restore
                </Chip>
              </div>
            ))}
          </div>
        </ChipModalField>
      )}

      <AddPeopleModal
        open={addOpen}
        onOpenChange={setAddOpen}
        existingMemberEmails={existingMemberEmails}
        addMember={addMember}
      />
    </>
  )
}
