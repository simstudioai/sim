'use client'
import { createLogger } from '@sim/logger'
import { credentialRoleLockReason, type MemberRole, MemberRow } from '@/components/permissions'
import {
  useRemoveWorkspaceCredentialMember,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
} from '@/hooks/queries/credentials'
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
  const { data: members = [], isPending: membersLoading } =
    useWorkspaceCredentialMembers(credentialId)
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()

  const activeMembers = members.filter((member) => member.status === 'active')
  const explicitAdminCount = activeMembers.filter(
    (member) => member.role === 'admin' && member.roleSource !== 'workspace-admin'
  ).length

  const handleChangeMemberRole = async (userId: string, role: MemberRole) => {
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
            return (
              <MemberRow
                key={member.id}
                member={member}
                lockReason={lockReason}
                canManage={isAdmin}
                roleDisabled={!isAdmin || roleLocked || lockReason !== null}
                removeDisabled={roleLocked || lockReason !== null}
                onRoleChange={(role) => handleChangeMemberRole(member.userId, role)}
                onRemove={() => handleRemoveMember(member.userId)}
              />
            )
          })}
        </div>
      )}
    </DetailSection>
  )
}
