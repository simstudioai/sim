import { useEffect, useState } from 'react'
import { LogOut, UserX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import type { Invitation, Member, Organization } from '@/stores/organization'

const logger = createLogger('TeamMembers')

interface ConsolidatedTeamMembersProps {
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
}: ConsolidatedTeamMembersProps) {
  const [memberUsageData, setMemberUsageData] = useState<Record<string, number>>({})
  const [isLoadingUsage, setIsLoadingUsage] = useState(false)

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
        usage: '-',
        invitation,
      }

      teamItems.push(invitationItem)
    })
  }

  if (teamItems.length === 0) {
    return <div className='text-center text-muted-foreground text-sm'>No team members yet.</div>
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
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm ${
                  item.type === 'member'
                    ? 'bg-primary/10 text-muted-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {item.avatarInitial}
              </div>

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
              {/* Allow non-owners to leave the organization themselves */}
              {item.type === 'member' &&
                item.role !== 'owner' &&
                item.email === currentUserEmail && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => onRemoveMember(item.member)}
                        className='h-8 w-8 rounded-[8px] text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                      >
                        <LogOut className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='left'>Leave Organization</TooltipContent>
                  </Tooltip>
                )}

              {/* Admin/Owner can remove other members */}
              {isAdminOrOwner &&
                item.type === 'member' &&
                item.role !== 'owner' &&
                item.email !== currentUserEmail && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => onRemoveMember(item.member)}
                        className='h-8 w-8 rounded-[8px] p-0'
                      >
                        <UserX className='h-4 w-4' />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side='left'>Remove Member</TooltipContent>
                  </Tooltip>
                )}

              {/* Admin can cancel invitations */}
              {isAdminOrOwner && item.type === 'invitation' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => onCancelInvitation(item.invitation.id)}
                      className='h-8 w-8 rounded-[8px] p-0'
                    >
                      <X className='h-4 w-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side='left'>Cancel Invitation</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
