import { UserX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Invitation, Member, Organization } from '@/stores/organization'

interface ConsolidatedTeamMembersProps {
  organization: Organization
  currentUserEmail: string
  isAdminOrOwner: boolean
  onRemoveMember: (member: Member) => void
  onCancelInvitation: (invitationId: string) => void
}

interface TeamMemberItem {
  type: 'member' | 'invitation'
  id: string
  name: string
  email: string
  role: string
  usage?: string
  lastActive?: string
  member?: Member
  invitation?: Invitation
}

export function TeamMembers({
  organization,
  currentUserEmail,
  isAdminOrOwner,
  onRemoveMember,
  onCancelInvitation,
}: ConsolidatedTeamMembersProps) {
  // Combine members and pending invitations into a single list
  const teamItems: TeamMemberItem[] = []

  // Add existing members
  if (organization.members) {
    organization.members.forEach((member: Member) => {
      teamItems.push({
        type: 'member',
        id: member.id,
        name: member.user?.name || 'Unknown',
        email: member.user?.email || '',
        role: member.role,
        usage: '$0.00', // TODO: Get real usage data
        lastActive: '8/26/2025', // TODO: Get real last active date
        member,
      })
    })
  }

  // Add pending invitations
  const pendingInvitations = organization.invitations?.filter(
    (invitation) => invitation.status === 'pending'
  )
  if (pendingInvitations) {
    pendingInvitations.forEach((invitation: Invitation) => {
      teamItems.push({
        type: 'invitation',
        id: invitation.id,
        name: invitation.email.split('@')[0], // Use email prefix as name
        email: invitation.email,
        role: 'pending',
        usage: '-',
        lastActive: '-',
        invitation,
      })
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
                {item.name.charAt(0).toUpperCase()}
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

              {/* Usage and stats - matching subscription layout */}
              <div className='hidden items-center gap-4 text-xs tabular-nums sm:flex'>
                <div className='text-center'>
                  <div className='text-muted-foreground'>Usage</div>
                  <div className='font-medium'>{item.usage}</div>
                </div>
                <div className='text-center'>
                  <div className='text-muted-foreground'>Active</div>
                  <div className='font-medium'>{item.lastActive}</div>
                </div>
              </div>
            </div>

            {/* Actions */}
            {isAdminOrOwner && (
              <div className='ml-4'>
                {item.type === 'member' &&
                  item.member?.role !== 'owner' &&
                  item.email !== currentUserEmail && (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => onRemoveMember(item.member!)}
                      className='h-8 w-8 rounded-[8px] p-0'
                    >
                      <UserX className='h-4 w-4' />
                    </Button>
                  )}

                {item.type === 'invitation' && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => onCancelInvitation(item.invitation!.id)}
                    className='h-8 w-8 rounded-[8px] p-0'
                  >
                    <X className='h-4 w-4' />
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
