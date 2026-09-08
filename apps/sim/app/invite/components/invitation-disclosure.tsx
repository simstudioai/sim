import type { InvitationDetails, MyInvitation } from '@/lib/api/contracts/invitations'

interface InvitationDisclosureProps {
  invitation: InvitationDetails
  joinPreview: MyInvitation['joinPreview']
}

export function InvitationDisclosure({ invitation, joinPreview }: InvitationDisclosureProps) {
  const outcome =
    joinPreview?.outcome ?? (invitation.membershipIntent === 'external' ? 'external' : null)
  const organizationName =
    joinPreview?.organizationName ??
    (invitation.kind === 'organization' ? invitation.organizationName : null) ??
    'the workspace’s organization'

  return (
    <div className='space-y-3 text-left text-[var(--text-body)] text-sm'>
      {outcome === 'will-join' && (
        <>
          <p>
            You will join <strong className='font-medium'>{organizationName}</strong> as an
            organization <strong className='font-medium'>{invitation.role}</strong>. This uses one
            organization seat.
          </p>
          {joinPreview && joinPreview.workspaceIdsToMove.length > 0 ? (
            <div>
              <p>
                Your owned personal workspaces, including archived workspaces, will move into the
                organization. Its administrators will be able to manage them:
              </p>
              <ul
                className='mt-1 list-disc space-y-1 pl-5'
                aria-label='Workspaces moving into the organization'
              >
                {joinPreview.workspaceIdsToMove.map((id, index) => (
                  <li key={id} className='break-words'>
                    {joinPreview.workspacesToMove[index] || 'Unnamed workspace'}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>You have no personal workspaces to move into the organization.</p>
          )}
        </>
      )}
      {outcome === 'already-member' && (
        <p>
          You already belong to this organization. Your organization role will stay the same. No
          additional seat is used, and none of your personal workspaces will move.
        </p>
      )}
      {outcome === 'external' && (
        <p>
          You will receive workspace access without joining an organization or using one of its
          seats. Your organization membership will stay the same, and none of your personal
          workspaces will move.
        </p>
      )}
      {outcome === 'blocked' && (
        <p>
          This invitation cannot currently be accepted. Try accepting to see what needs to be
          resolved, or contact the person who invited you.
        </p>
      )}
      {outcome === null && (
        <p>
          We could not load how this invitation affects your organization and personal workspaces.
          Refresh the invitation to review these details before accepting.
        </p>
      )}
      {invitation.grants.length > 0 && (
        <div>
          <p>Invited workspace access:</p>
          <ul className='mt-1 list-disc space-y-1 pl-5' aria-label='Invited workspace access'>
            {invitation.grants.map((grant) => (
              <li key={grant.workspaceId} className='break-words'>
                {grant.workspaceName || 'Unnamed workspace'}: {grant.permission} access
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
