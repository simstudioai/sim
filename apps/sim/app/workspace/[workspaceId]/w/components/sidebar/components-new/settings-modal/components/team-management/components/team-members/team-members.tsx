import { useEffect, useState } from 'react'
import { UserX, X } from 'lucide-react'
import { Button, Tooltip } from '@/components/emcn'
import { Button as UIButton } from '@/components/ui/button'
import { UserAvatar } from '@/components/user-avatar/user-avatar'
import { createLogger } from '@/lib/logs/console/logger'
import type { Invitation, Member, Organization } from '@/stores/organization'

const logger = createLogger('TeamMembers')

interface TeamMembersProps {
  organization: Organization
  currentUserEmail: string
  isAdminOrOwner: boolean
  onRemoveMember: (member: Member) => void
  onCancelInvitation: (invitationId: string) => void
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
  onCancelInvitation,
}: TeamMembersProps) {
  const [memberUsageData, setMemberUsageData] = useState<Record<string, number>>({})
  const [isLoadingUsage, setIsLoadingUsage] = useState(false)
  const [cancellingInvitations, setCancellingInvitations] = useState<Set<string>>(new Set())

  // Fetch member usage data when organization changes and user is admin
  useEffect(() => {
    const fetchMemberUsage = async () => {
      if (!organization?.id || !isAdminOrOwner) return

      setIsLoadingUsage(true)
      try {
        const response = await fetch(`/api/organizations/${organization.id}/members?include=usage`)
        if (response.ok) {
          const result = await response.json()
          const usageMap: Record<string, number> = {}

          if (result.data) {
            result.data.forEach((member: any) => {
              if (member.currentPeriodCost !== null && member.currentPeriodCost !== undefined) {
                usageMap[member.userId] = Number.parseFloat(member.currentPeriodCost.toString())
              }
            })
          }

          setMemberUsageData(usageMap)
        }
      } catch (error) {
        logger.error('Failed to fetch member usage data', { error })
      } finally {
        setIsLoadingUsage(false)
      }
    }

    fetchMemberUsage()
  }, [organization?.id, isAdminOrOwner])

  // Combine members and pending invitations into a single list
  const teamItems: TeamMemberItem[] = []

  // Add existing members
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

  // Add pending invitations
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
        userId: invitation.email, // Use email as fallback for color generation
        usage: '-',
        invitation,
      }

      teamItems.push(invitationItem)
    })
  }

  if (teamItems.length === 0) {
    return <div className='text-center text-muted-foreground text-sm'>No team members yet.</div>
  }

  // Check if current user can leave (is a member but not owner)
  const currentUserMember = organization.members?.find((m) => m.user?.email === currentUserEmail)
  const canLeaveOrganization =
    currentUserMember && currentUserMember.role !== 'owner' && currentUserMember.user?.id

  // Wrap onCancelInvitation to manage loading state
  const handleCancelInvitation = async (invitationId: string) => {
    setCancellingInvitations((prev) => new Set([...prev, invitationId]))
    try {
      await onCancelInvitation(invitationId)
    } finally {
      setCancellingInvitations((prev) => {
        const next = new Set(prev)
        next.delete(invitationId)
        return next
      })
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Header - simple like account page */}
      <div>
        <h4 className='font-medium text-sm'>Team Members</h4>
      </div>

      {/* Members list - clean like account page */}
      <div className='space-y-4'>
        {teamItems.map((item) => (
          <div key={item.id} className='flex items-center justify-between'>
            {/* Member info */}
            <div className='flex flex-1 items-center gap-3'>
              {/* Avatar */}
              <UserAvatar
                userId={item.userId || item.email}
                userName={item.name}
                avatarUrl={item.avatarUrl}
                size={32}
              />

              {/* Name and email */}
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium text-sm'>{item.name}</span>
                  {item.type === 'member' && (
                    <span
                      className={`inline-flex h-[1.125rem] items-center rounded-[6px] px-2 py-0 font-medium text-xs ${
                        item.role === 'owner'
                          ? 'gradient-text border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
                          : 'bg-primary/10 text-muted-foreground'
                      } `}
                    >
                      {item.role.charAt(0).toUpperCase() + item.role.slice(1)}
                    </span>
                  )}
                  {item.type === 'invitation' && (
                    <span className='inline-flex h-[1.125rem] items-center rounded-[6px] bg-muted px-2 py-0 font-medium text-muted-foreground text-xs'>
                      Pending
                    </span>
                  )}
                </div>
                <div className='truncate text-muted-foreground text-xs'>{item.email}</div>
              </div>

              {/* Usage stats - matching subscription layout */}
              {isAdminOrOwner && (
                <div className='hidden items-center text-xs tabular-nums sm:flex'>
                  <div className='text-center'>
                    <div className='text-muted-foreground'>Usage</div>
                    <div className='font-medium'>
                      {isLoadingUsage && item.type === 'member' ? (
                        <span className='inline-block h-3 w-12 animate-pulse rounded bg-muted' />
                      ) : (
                        item.usage
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className='ml-4 flex gap-1'>
              {/* Admin/Owner can remove other members */}
              {isAdminOrOwner &&
                item.type === 'member' &&
                item.role !== 'owner' &&
                item.email !== currentUserEmail && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <UIButton
                        variant='outline'
                        size='sm'
                        onClick={() => onRemoveMember(item.member)}
                        className='h-8 w-8 rounded-[8px] p-0'
                      >
                        <UserX className='h-4 w-4' />
                      </UIButton>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='left'>Remove Member</Tooltip.Content>
                  </Tooltip.Root>
                )}

              {/* Admin can cancel invitations */}
              {isAdminOrOwner && item.type === 'invitation' && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <UIButton
                      variant='outline'
                      size='sm'
                      onClick={() => handleCancelInvitation(item.invitation.id)}
                      disabled={cancellingInvitations.has(item.invitation.id)}
                      className='h-8 w-8 rounded-[8px] p-0'
                    >
                      {cancellingInvitations.has(item.invitation.id) ? (
                        <span className='h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent' />
                      ) : (
                        <X className='h-4 w-4' />
                      )}
                    </UIButton>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='left'>
                    {cancellingInvitations.has(item.invitation.id)
                      ? 'Cancelling...'
                      : 'Cancel Invitation'}
                  </Tooltip.Content>
                </Tooltip.Root>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Leave Organization button */}
      {canLeaveOrganization && (
        <div className='mt-4 border-[var(--border-muted)] border-t pt-4'>
          <Button
            variant='default'
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
