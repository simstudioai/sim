import { AuthResourceIdentity, AuthResourceRow, AuthTag } from '@sim/auth-ui'
import { ChipTag } from '@sim/emcn'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { InvitationDetails } from '@/lib/api/contracts/invitations'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface InvitationWorkspaceAccessProps {
  grants: InvitationDetails['grants']
  appearance?: 'app' | 'auth'
}

export function InvitationWorkspaceAccess({
  grants,
  appearance = 'app',
}: InvitationWorkspaceAccessProps) {
  return (
    <ul
      className={appearance === 'auth' ? 'au:list-none au:space-y-2' : 'space-y-2'}
      aria-label='Invited workspace access'
    >
      {grants.map((grant) => (
        <li key={grant.workspaceId}>
          {appearance === 'auth' ? (
            <AuthResourceRow
              icon={
                <AuthResourceIdentity
                  initial={getWorkspaceInitial(grant.workspaceName ?? undefined)}
                  logoUrl={grant.workspaceLogoUrl}
                />
              }
              title={grant.workspaceName || 'Unnamed workspace'}
              actions={<AuthTag>{grant.permission} access</AuthTag>}
            />
          ) : (
            <SettingsResourceRow
              flush
              icon={
                <IdentityTile
                  initial={getWorkspaceInitial(grant.workspaceName ?? undefined)}
                  logoUrl={grant.workspaceLogoUrl}
                />
              }
              iconVariant='custom'
              title={grant.workspaceName || 'Unnamed workspace'}
              badge={<ChipTag variant='gray'>{grant.permission} access</ChipTag>}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
