import { ChipTag } from '@sim/emcn'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import type { InvitationDetails } from '@/lib/api/contracts/invitations'
import { getWorkspaceInitial } from '@/lib/workspaces/initials'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface InvitationWorkspaceAccessProps {
  grants: InvitationDetails['grants']
}

export function InvitationWorkspaceAccess({ grants }: InvitationWorkspaceAccessProps) {
  return (
    <ul className='space-y-2' aria-label='Invited workspace access'>
      {grants.map((grant) => (
        <li key={grant.workspaceId}>
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
        </li>
      ))}
    </ul>
  )
}
