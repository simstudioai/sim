import { AuthResourceIdentity, AuthResourceRow } from '@sim/auth-ui'
import type { InvitationDetails, MyInvitation } from '@/lib/api/contracts/invitations'
import { InvitationWorkspaceAccess } from '@/app/invite/components/invitation-workspace-access'

interface InvitationDisclosureProps {
  invitation: InvitationDetails
  joinPreview: MyInvitation['joinPreview']
  showWorkspaceAccess?: boolean
  appearance?: 'app' | 'auth'
}

export function InvitationDisclosure({
  invitation,
  joinPreview,
  showWorkspaceAccess = true,
  appearance = 'app',
}: InvitationDisclosureProps) {
  const auth = appearance === 'auth'
  const outcome =
    joinPreview?.outcome ?? (invitation.membershipIntent === 'external' ? 'external' : null)
  const organizationName =
    joinPreview?.organizationName ??
    (invitation.kind === 'organization' ? invitation.organizationName : null) ??
    'the workspace’s organization'

  return (
    <div
      className={
        auth
          ? 'au:space-y-3 au:text-left au:text-[var(--auth-primary)] au:text-control'
          : 'space-y-3 text-left text-[var(--text-body)] text-small'
      }
    >
      {outcome === 'will-join' && (
        <>
          <p>
            You will join{' '}
            <strong className={auth ? 'au:font-medium' : 'font-medium'}>{organizationName}</strong>{' '}
            as an organization{' '}
            <strong className={auth ? 'au:font-medium' : 'font-medium'}>{invitation.role}</strong>.
            This uses one organization seat.
          </p>
          {joinPreview && joinPreview.workspaceIdsToMove.length > 0 ? (
            <div>
              <p>
                Your owned personal workspaces, including archived workspaces, will move into the
                organization. Its administrators will be able to manage them:
              </p>
              <ul
                className={auth ? 'au:mt-2 au:list-none' : 'mt-1 list-disc space-y-1 pl-5'}
                aria-label='Workspaces moving into the organization'
              >
                {joinPreview.workspaceIdsToMove.map((id, index) => (
                  <li key={id} className={auth ? 'au:break-words' : 'break-words'}>
                    {auth ? (
                      <AuthResourceRow
                        icon={
                          <AuthResourceIdentity
                            initial={(joinPreview.workspacesToMove[index] || 'W')
                              .slice(0, 1)
                              .toUpperCase()}
                          />
                        }
                        title={joinPreview.workspacesToMove[index] || 'Unnamed workspace'}
                      />
                    ) : (
                      joinPreview.workspacesToMove[index] || 'Unnamed workspace'
                    )}
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
      {showWorkspaceAccess && invitation.grants.length > 0 && (
        <div className={auth ? 'au:space-y-2' : 'space-y-2'}>
          <p
            className={
              auth
                ? 'au:text-[var(--auth-secondary)] au:text-caption'
                : 'text-[var(--text-muted)] text-caption'
            }
          >
            Workspace access
          </p>
          <InvitationWorkspaceAccess grants={invitation.grants} appearance={appearance} />
        </div>
      )}
    </div>
  )
}
