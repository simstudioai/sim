import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Invitation, Organization } from '@/stores/organization'

interface PendingInvitationsListProps {
  organization: Organization
  onCancelInvitation: (invitationId: string) => void
}

export function PendingInvitationsList({
  organization,
  onCancelInvitation,
}: PendingInvitationsListProps) {
  const pendingInvitations = organization.invitations?.filter(
    (invitation) => invitation.status === 'pending'
  )

  if (!pendingInvitations || pendingInvitations.length === 0) {
    return null
  }

  return (
    <div className='rounded-md border'>
      <h4 className='border-b p-4 font-medium text-sm'>Pending Invitations</h4>
      <div className='divide-y'>
        {pendingInvitations.map((invitation: Invitation) => (
          <div key={invitation.id} className='flex items-center justify-between p-4'>
            <div className='flex-1'>
              <div className='flex items-center gap-3'>
                <div className='flex h-8 w-8 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm'>
                  {invitation.email.charAt(0).toUpperCase()}
                </div>
                <div className='flex-1'>
                  <div className='font-medium'>{invitation.email}</div>
                  <div className='text-muted-foreground text-sm'>Invitation pending</div>
                </div>
              </div>
            </div>

            <Button variant='outline' size='sm' onClick={() => onCancelInvitation(invitation.id)}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
