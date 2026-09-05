'use client'

import { useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import type { AuthorizedApp } from '@/lib/api/contracts/user'
import { summarizeOAuthAccess } from '@/lib/auth/oauth-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useAuthorizedApps, useRevokeAuthorizedApp } from '@/hooks/queries/oauth-provider'

const EMPTY_APPS: AuthorizedApp[] = []

/**
 * The apps this account has authorized through Sim's OAuth provider. Revoking
 * one withdraws its consent and kills every token it holds, so the next
 * request it makes fails and the next sign-in asks again.
 */
export function AuthorizedApps() {
  const apps = useAuthorizedApps()
  const revoke = useRevokeAuthorizedApp()
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [pendingRevokeClientId, setPendingRevokeClientId] = useState<string | null>(null)

  const list = apps.data ?? EMPTY_APPS
  const pendingRevoke = list.find((app) => app.clientId === pendingRevokeClientId) ?? null
  const term = searchTerm.trim().toLowerCase()
  const filtered = term ? list.filter((app) => app.name.toLowerCase().includes(term)) : list

  const confirmRevoke = () => {
    if (!pendingRevokeClientId) return
    const appName = pendingRevoke?.name ?? 'app'
    revoke.mutate(pendingRevokeClientId, {
      onSuccess: () => toast.success(`Revoked ${appName}`),
      onError: (error) => toast.error(getErrorMessage(error, 'Failed to revoke access')),
      /** Keep the modal open so its pending state remains visible through the mutation. */
      onSettled: () => setPendingRevokeClientId(null),
    })
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search authorized apps...',
        }}
      >
        {apps.isError && apps.data === undefined ? (
          <SettingsEmptyState tone='error'>
            {getErrorMessage(apps.error, 'Failed to load authorized apps')}
          </SettingsEmptyState>
        ) : apps.isPending ? null : list.length === 0 ? (
          <SettingsEmptyState>No apps have access to your account</SettingsEmptyState>
        ) : filtered.length === 0 ? (
          <SettingsEmptyState variant='inline'>
            No apps found matching "{searchTerm}"
          </SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {filtered.map((app) => (
              <SettingsResourceRow
                key={app.clientId}
                title={app.name}
                description={summarizeOAuthAccess(app.scopes)}
                badge={
                  <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
                    {`authorized ${formatDate(new Date(app.authorizedAt))}`}
                  </span>
                }
                trailing={
                  <RowActionsMenu
                    label='Authorized app actions'
                    actions={[
                      {
                        label: 'Revoke',
                        destructive: true,
                        onSelect: () => setPendingRevokeClientId(app.clientId),
                      },
                    ]}
                  />
                }
              />
            ))}
          </div>
        )}
      </SettingsPanel>

      <ChipConfirmModal
        open={pendingRevokeClientId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevokeClientId(null)
        }}
        srTitle='Revoke access'
        title='Revoke access'
        text={[
          'Revoking ',
          { text: pendingRevoke?.name ?? 'this app', bold: true },
          ' ',
          { text: 'immediately signs it out everywhere.', error: true },
          ' You will have to authorize it again to reconnect.',
        ]}
        confirm={{
          label: 'Revoke',
          onClick: confirmRevoke,
          pending: revoke.isPending,
          pendingLabel: 'Revoking...',
        }}
      />
    </>
  )
}
