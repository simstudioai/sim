'use client'

import { useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import {
  credentialRoleLockReason,
  MEMBER_ROLE_OPTIONS,
  type MemberRole,
  MemberRow,
  type MemberRowAction,
} from '@/components/permissions'
import { useSession } from '@/lib/auth/client'
import {
  useLeaveCredential,
  useRemoveWorkspaceCredentialMember,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
} from '@/hooks/queries/credentials'
import { DetailSection } from './detail-section'

const logger = createLogger('CredentialMembersSection')

interface CredentialMembersSectionProps {
  credentialId: string
  credentialName: string
  isAdmin: boolean
  /** Where the viewer lands after leaving, since leaving revokes their access. */
  leaveHref: string
}

/**
 * Active-member list for a credential: avatar + identity, a role dropdown, a
 * remove action for admins, and a leave action on the viewer's own row. The
 * last remaining admin cannot be demoted, removed, or leave. Shared by every
 * credential detail surface.
 */
export function CredentialMembersSection({
  credentialId,
  credentialName,
  isAdmin,
  leaveHref,
}: CredentialMembersSectionProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { data: members = [], isPending: membersLoading } =
    useWorkspaceCredentialMembers(credentialId)
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()
  const leaveCredential = useLeaveCredential()

  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false)

  const viewerId = session?.user?.id
  const activeMembers = members.filter((member) => member.status === 'active')
  const explicitAdminCount = activeMembers.filter((member) => member.explicitAdmin).length
  const showActions = isAdmin || activeMembers.some((member) => member.userId === viewerId)

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

  const handleConfirmLeave = async () => {
    try {
      await leaveCredential.mutateAsync(credentialId)
      setIsLeaveConfirmOpen(false)
      router.push(leaveHref)
    } catch (error) {
      toast.error("Couldn't leave credential", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to leave credential', error)
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
            const actionDisabled = roleLocked || lockReason !== null
            const action: MemberRowAction | null =
              member.userId === viewerId
                ? {
                    label: 'Leave',
                    disabled: actionDisabled,
                    disabledReason:
                      lockReason ??
                      (roleLocked ? 'Make someone else an admin before leaving' : null),
                    onSelect: () => setIsLeaveConfirmOpen(true),
                  }
                : isAdmin
                  ? {
                      label: 'Remove',
                      disabled: actionDisabled,
                      onSelect: () => handleRemoveMember(member.userId),
                    }
                  : null
            return (
              <MemberRow
                key={member.id}
                member={{ ...member, userImage: member.userImage ?? null }}
                roleOptions={MEMBER_ROLE_OPTIONS}
                lockReason={lockReason}
                showActions={showActions}
                action={action}
                roleDisabled={!isAdmin || actionDisabled}
                onRoleChange={(role) => handleChangeMemberRole(member.userId, role)}
              />
            )
          })}
        </div>
      )}

      <ChipConfirmModal
        open={isLeaveConfirmOpen}
        onOpenChange={setIsLeaveConfirmOpen}
        title='Leave credential'
        text={[
          'Are you sure you want to leave ',
          { text: credentialName, bold: true },
          '? You will lose access to it until an admin adds you back.',
        ]}
        confirm={{
          label: 'Leave',
          onClick: handleConfirmLeave,
          pending: leaveCredential.isPending,
          pendingLabel: 'Leaving...',
        }}
      />
    </DetailSection>
  )
}
