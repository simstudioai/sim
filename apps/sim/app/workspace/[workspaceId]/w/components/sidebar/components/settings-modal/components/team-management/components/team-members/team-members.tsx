'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Avatar, AvatarFallback, AvatarImage, Badge, Button } from '@/components/emcn'
import type { Invitation, Member, Organization } from '@/lib/workspaces/organization'
import { getUserColor } from '@/app/workspace/[workspaceId]/w/utils/get-user-color'
import { useCancelInvitation, useOrganizationMembers } from '@/hooks/queries/organization'

const logger = createLogger('TeamMembers')

interface TeamMembersProps {
  organization: Organization
  currentUserEmail: string
  isAdminOrOwner: boolean
  onRemoveMember: (member: Member) => void
}

interface BaseItem {
  id: string
  name: string
  email: string
  avatarInitial: string
  avatarUrl?: string | null
  userId?: string
  usage: string
}

interface MemberItem extends BaseItem {
  type: 'member'
  role: string
  member: Member
}

interface InvitationItem extends BaseItem {
  type: 'invitation'
  invitation: Invitation
}

type TeamMemberItem = MemberItem | InvitationItem

export function TeamMembers({
  organization,
  currentUserEmail,
  isAdminOrOwner,
  onRemoveMember,
}: TeamMembersProps) {
  const [cancellingInvitations, setCancellingInvitations] = useState<Set<string>>(new Set())

  const { data: memberUsageResponse, isLoading: isLoadingUsage } = useOrganizationMembers(
    organization?.id || ''
  )

  const cancelInvitationMutation = useCancelInvitation()

  const memberUsageData: Record<string, number> = {}
  if (memberUsageResponse?.data) {
    memberUsageResponse.data.forEach(
      (member: { userId: string; currentPeriodCost?: number | null }) => {
        if (member.currentPeriodCost !== null && member.currentPeriodCost !== undefined) {
          memberUsageData[member.userId] = Number.parseFloat(member.currentPeriodCost.toString())
        }
      }
    )
  }

  const teamItems: TeamMemberItem[] = []

  if (organization.members) {
    organization.members.forEach((member: Member) => {
      const userId = member.user?.id
      const usageAmount = userId ? (memberUsageData[userId] ?? 0) : 0
      const name = member.user?.name || 'Unknown'

      const memberItem: MemberItem = {
        type: 'member',
        id: member.id,
        name,
        email: member.user?.email || '',
        avatarInitial: name.charAt(0).toUpperCase(),
        avatarUrl: member.user?.image,
        userId: member.user?.id,
        usage: `$${usageAmount.toFixed(2)}`,
        role: member.role,
        member,
      }

      teamItems.push(memberItem)
    })
  }

  const pendingInvitations = organization.invitations?.filter(
    (invitation) => invitation.status === 'pending'
  )
  if (pendingInvitations) {
    pendingInvitations.forEach((invitation: Invitation) => {
      const emailPrefix = invitation.email.split('@')[0]

      const invitationItem: InvitationItem = {
        type: 'invitation',
        id: invitation.id,
        name: emailPrefix,
        email: invitation.email,
        avatarInitial: emailPrefix.charAt(0).toUpperCase(),
        avatarUrl: null,
        userId: invitation.email,
        usage: '-',
        invitation,
      }

      teamItems.push(invitationItem)
    })
  }

  if (teamItems.length === 0) {
    return <div className='text-center text-[var(--text-muted)] text-sm'>No team members yet.</div>
  }

  const currentUserMember = organization.members?.find((m) => m.user?.email === currentUserEmail)
  const canLeaveOrganization =
    currentUserMember && currentUserMember.role !== 'owner' && currentUserMember.user?.id

  const handleCancelInvitation = async (invitationId: string) => {
    if (!organization?.id) return

    setCancellingInvitations((prev) => new Set([...prev, invitationId]))
    try {
      await cancelInvitationMutation.mutateAsync({
        invitationId,
        orgId: organization.id,
      })
    } catch (error) {
      logger.error('Failed to cancel invitation', { error })
    } finally {
      setCancellingInvitations((prev) => {
        const next = new Set(prev)
        next.delete(invitationId)
        return next
      })
    }
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      {/* Header */}
      <div>
        <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>Team Members</h4>
      </div>

      {/* Members list */}
      <div className='flex flex-col gap-[16px]'>
        {teamItems.map((item) => (
          <div key={item.id} className='flex items-center justify-between'>
            {/* Left section: Avatar + Name/Role + Action buttons */}
            <div className='flex flex-1 items-center gap-[12px]'>
              {/* Avatar */}
              <Avatar size='sm'>
                {item.avatarUrl && <AvatarImage src={item.avatarUrl} alt={item.name} />}
                <AvatarFallback
                  style={{ background: getUserColor(item.userId || item.email) }}
                  className='border-0 text-white'
                >
                  {item.avatarInitial}
                </AvatarFallback>
              </Avatar>

              {/* Name and email */}
              <div className='min-w-0'>
                <div className='flex items-center gap-[8px]'>
                  <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                    {item.name}
                  </span>
                  {item.type === 'member' && (
                    <Badge
                      variant={item.role === 'owner' ? 'blue-secondary' : 'gray-secondary'}
                      size='sm'
                    >
                      {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
                    </Badge>
                  )}
                  {item.type === 'invitation' && (
                    <Badge variant='amber' size='sm'>
                      Pending
                    </Badge>
                  )}
                </div>
                <div className='truncate text-[12px] text-[var(--text-muted)]'>{item.email}</div>
              </div>

              {/* Action buttons */}
              {isAdminOrOwner && (
                <>
                  {/* Admin/Owner can remove other members */}
                  {item.type === 'member' &&
                    item.role !== 'owner' &&
                    item.email !== currentUserEmail && (
                      <Button
                        variant='ghost'
                        onClick={() => onRemoveMember(item.member)}
                        className='h-8'
                      >
                        Remove
                      </Button>
                    )}

                  {/* Admin can cancel invitations */}
                  {item.type === 'invitation' && (
                    <Button
                      variant='ghost'
                      onClick={() => handleCancelInvitation(item.invitation.id)}
                      disabled={cancellingInvitations.has(item.invitation.id)}
                      className='h-8'
                    >
                      {cancellingInvitations.has(item.invitation.id) ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Right section: Usage column (right-aligned) */}
            {isAdminOrOwner && (
              <div className='ml-[16px] flex flex-col items-end'>
                <div className='text-[12px] text-[var(--text-muted)]'>Usage</div>
                <div className='font-medium text-[12px] text-[var(--text-primary)] tabular-nums'>
                  {isLoadingUsage && item.type === 'member' ? (
                    <span className='inline-block h-3 w-12 animate-pulse rounded-[4px] bg-[var(--surface-4)]' />
                  ) : (
                    item.usage
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Leave Organization button */}
      {canLeaveOrganization && (
        <div className='mt-[4px] border-[var(--border-1)] border-t pt-[16px]'>
          <Button
            variant='active'
            onClick={() => {
              if (!currentUserMember?.user?.id) {
                logger.error('Cannot leave organization: missing user ID', { currentUserMember })
                return
              }
              onRemoveMember(currentUserMember)
            }}
          >
            Leave Organization
          </Button>
        </div>
      )}
    </div>
  )
}
