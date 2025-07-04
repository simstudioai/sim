import { CheckCircle, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Invitation = {
  id: string
  email: string
  status: string
}

type Organization = {
  id: string
  name: string
  slug: string
  members?: any[]
  invitations?: Invitation[]
  createdAt: string | Date
  [key: string]: unknown
}

interface PendingInvitationsListProps {
  organization: Organization
  onCancelInvitation: (invitationId: string) => Promise<void>
}

function getInvitationStatus(status: string) {
  switch (status) {
    case 'pending':
      return (
        <div className='flex items-center text-amber-500'>
          <RefreshCw className='mr-1 h-4 w-4' />
          <span>Pending</span>
        </div>
      )
    case 'accepted':
      return (
        <div className='flex items-center text-green-500'>
          <CheckCircle className='mr-1 h-4 w-4' />
          <span>Accepted</span>
        </div>
      )
    case 'canceled':
      return (
        <div className='flex items-center text-red-500'>
          <XCircle className='mr-1 h-4 w-4' />
          <span>Canceled</span>
        </div>
      )
    default:
      return status
  }
}

export function PendingInvitationsList({
  organization,
  onCancelInvitation,
}: PendingInvitationsListProps) {
  if (!organization.invitations || organization.invitations.length === 0) {
    return null
  }

  return (
    <div className='rounded-md border'>
      <h4 className='border-b p-4 font-medium text-sm'>Pending Invitations</h4>
      <div className='divide-y'>
        {organization.invitations.map((invitation: Invitation) => (
          <div key={invitation.id} className='flex items-center justify-between p-4'>
            <div>
              <div className='font-medium'>{invitation.email}</div>
              <div className='mt-1 text-xs'>{getInvitationStatus(invitation.status)}</div>
            </div>

            {invitation.status === 'pending' && (
              <Button variant='outline' size='sm' onClick={() => onCancelInvitation(invitation.id)}>
                <XCircle className='h-4 w-4' />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
