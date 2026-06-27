'use client'

import { createLogger } from '@sim/logger'
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, Chip, ChipDropdown } from '@/components/emcn'
import { credentialRoleLockReason, RoleLockTooltip } from '@/components/permissions'
import { cn } from '@/lib/core/utils/cn'
import { getUserColor } from '@/lib/workspaces/colors'
import {
  useRemoveWorkspaceCredentialMember,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
  type WorkspaceCredentialRole,
} from '@/hooks/queries/credentials'
import { ROLE_OPTIONS } from '../roles'
import { DetailSection } from './detail-section'

const logger = createLogger('CredentialMembersSection')

interface CredentialMembersSectionProps {
  credentialId: string
  isAdmin: boolean
}

/**
 * Active-member list for a credential: avatar + identity, a role dropdown, and a
 * remove action. The last remaining admin cannot be demoted or removed. Shared
 * by every credential detail surface.
 */
export function CredentialMembersSection({ credentialId, isAdmin }: CredentialMembersSectionProps) {
  const t = useTranslations('auto')
  const { data: members = [], isPending: membersLoading } =
    useWorkspaceCredentialMembers(credentialId)
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()

  const activeMembers = members.filter((member) => member.status === 'active')
  const explicitAdminCount = activeMembers.filter(
    (member) => member.role === 'admin' && member.roleSource !== 'workspace-admin'
  ).length

  const handleChangeMemberRole = async (userId: string, role: WorkspaceCredentialRole) => {
    const current = activeMembers.find((member) => member.userId === userId)
    if (current?.role === role) return
    try {
      await upsertMember.mutateAsync({ credentialId, userId, role })
    } catch (error) {
      logger.error('Failed to change member role', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync({ credentialId, userId })
    } catch (error) {
      logger.error('Failed to remove credential member', error)
    }
  }

  return (
    <DetailSection title={`Members (${activeMembers.length})`}>
      {membersLoading ? null : (
        <div className='flex flex-col gap-2'>
          {activeMembers.map((member) => {
            const lockReason = credentialRoleLockReason(member.roleSource)
            const roleLocked =
              member.role === 'admin' &&
              member.roleSource !== 'workspace-admin' &&
              explicitAdminCount <= 1
            const roleDisabled = !isAdmin || roleLocked || lockReason !== null
            const removeDisabled = roleLocked || lockReason !== null
            return (
              <div
                key={member.id}
                className={cn(
                  'grid items-center gap-2',
                  isAdmin ? 'grid-cols-[1fr_120px_72px]' : 'grid-cols-[1fr_200px]'
                )}
              >
                <div className='flex min-w-0 items-center gap-2.5'>
                  <Avatar className='size-9 flex-shrink-0'>
                    <AvatarFallback
                      style={{
                        background: getUserColor(member.userId || member.userEmail || ''),
                      }}
                      className='border border-[var(--border-1)] text-small text-white'
                    >
                      {(member.userName || member.userEmail || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className='flex min-w-0 flex-col'>
                    <span className='truncate text-[14px] text-[var(--text-body)]'>
                      {member.userName || member.userEmail || member.userId}
                    </span>
                    <span className='truncate text-[12px] text-[var(--text-muted)]'>
                      {member.userEmail || member.userId}
                    </span>
                  </div>
                </div>
                <RoleLockTooltip reason={lockReason}>
                  <ChipDropdown
                    options={ROLE_OPTIONS}
                    value={member.role}
                    placeholder={t('role')}
                    disabled={roleDisabled}
                    onChange={(role) =>
                      handleChangeMemberRole(member.userId, role as WorkspaceCredentialRole)
                    }
                  />
                </RoleLockTooltip>
                {isAdmin && (
                  <Chip
                    onClick={() => handleRemoveMember(member.userId)}
                    disabled={removeDisabled}
                    flush
                    className='justify-self-end'
                  >
                    {t('remove')}
                  </Chip>
                )}
              </div>
            )
          })}
        </div>
      )}
    </DetailSection>
  )
}
