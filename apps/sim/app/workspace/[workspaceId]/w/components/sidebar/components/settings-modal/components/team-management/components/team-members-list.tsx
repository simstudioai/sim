import { UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Member, Organization } from '@/stores/organization'

interface TeamMembersListProps {
  organization: Organization
  currentUserEmail: string
  isAdminOrOwner: boolean
  onRemoveMember: (member: Member) => void
}

export function TeamMembersList({
  organization,
  currentUserEmail,
  isAdminOrOwner,
  onRemoveMember,
}: TeamMembersListProps) {
  if (!organization.members || organization.members.length === 0) {
    return (
      <div className='rounded-md border'>
        <h4 className='border-b p-4 font-medium text-sm'>Team Members</h4>
        <div className='p-4 text-muted-foreground text-sm'>
          No members in this organization yet.
        </div>
      </div>
    )
  }

  return (
    <div className='rounded-md border'>
      <h4 className='border-b p-4 font-medium text-sm'>Team Members</h4>
      <div className='divide-y'>
        {organization.members.map((member: Member) => (
          <div key={member.id} className='flex items-center justify-between p-4'>
            <div className='flex-1'>
              <div className='flex items-center gap-3'>
                <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-sm'>
                  {(member.user?.name || member.user?.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className='flex-1'>
                  <div className='font-medium'>{member.user?.name || 'Unknown'}</div>
                  <div className='text-muted-foreground text-sm'>{member.user?.email}</div>
                </div>
                <div className='rounded-full bg-primary/10 px-3 py-1 font-medium text-primary text-xs'>
                  {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                </div>
              </div>
            </div>

            {/* Only show remove button for non-owners and if current user is admin/owner */}
            {isAdminOrOwner &&
              member.role !== 'owner' &&
              member.user?.email !== currentUserEmail && (
                <Button variant='outline' size='sm' onClick={() => onRemoveMember(member)}>
                  <UserX className='h-4 w-4' />
                </Button>
              )}
          </div>
        ))}
      </div>
    </div>
  )
}
