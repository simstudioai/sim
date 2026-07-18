'use client'

import { Chip } from '@sim/emcn'
import { MemberRow } from '@/components/permissions'
import { DetailSection } from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  type SkillMembersController,
  skillMemberLockReason,
} from '@/app/workspace/[workspaceId]/skills/components/skill-members'

interface SkillMembersCardProps {
  members: SkillMembersController
  /** Whether the viewer is a skill admin (explicit or derived workspace admin). */
  isAdmin: boolean
  workspaceShared: boolean
}

/**
 * Page-styled member roster for the skill detail page: active members with
 * role/remove controls, and — for admins — removed (denied) members with a
 * restore action. Adding people happens through the header Share action.
 */
export function SkillMembersCard({ members, isAdmin, workspaceShared }: SkillMembersCardProps) {
  return (
    <>
      <DetailSection title={`Members (${members.activeMembers.length})`}>
        {members.membersError ? (
          <span className='text-[12px] text-[var(--text-muted)]'>
            Couldn't load members. You may no longer have access to this skill.
          </span>
        ) : members.membersLoading ? null : (
          <div className='flex flex-col gap-2'>
            {members.activeMembers.map((member) => {
              const lockReason = skillMemberLockReason(member, {
                workspaceShared,
                explicitAdminCount: members.explicitAdminCount,
              })
              return (
                <MemberRow
                  key={member.id}
                  member={member}
                  lockReason={lockReason}
                  canManage={isAdmin}
                  roleDisabled={!isAdmin || lockReason !== null}
                  removeDisabled={lockReason !== null}
                  onRoleChange={(role) => members.changeMemberRole(member.userId, role)}
                  onRemove={() => members.removeMember(member.userId)}
                />
              )
            })}
          </div>
        )}
      </DetailSection>

      {isAdmin && members.removedMembers.length > 0 && (
        <DetailSection title={`Removed (${members.removedMembers.length})`}>
          <div className='flex flex-col gap-2'>
            {members.removedMembers.map((member) => (
              <div key={member.id} className='flex items-center justify-between gap-2'>
                <span className='min-w-0 truncate text-[14px] text-[var(--text-muted)]'>
                  {member.userName || member.userEmail || member.userId}
                </span>
                <Chip onClick={() => members.restoreMember(member.userId)} flush>
                  Restore
                </Chip>
              </div>
            ))}
          </div>
        </DetailSection>
      )}
    </>
  )
}
