import { AuthResourceIdentity } from '@sim/emcn-auth/identity'
import { AuthResourceRow } from '@sim/emcn-auth/resource'
import { AuthTag } from '@sim/emcn-auth/tag'
import { ChipTag } from '@sim/emcn-legacy'
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
      className={appearance === 'auth' ? 'au:flex au:list-none au:flex-col au:gap-2' : 'space-y-2'}
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
