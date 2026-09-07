'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { summarizeOAuthAccess } from '@/lib/auth/oauth-provider'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useAuthorizedApps, useRevokeAuthorizedApp } from '@/hooks/queries/oauth-provider'

/**
 * The apps this account has authorized through Sim's OAuth provider. Revoking
 * one withdraws its consent and kills every token it holds, so the next
 * request it makes fails and the next sign-in asks again.
 */
export function AuthorizedApps() {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const apps = useAuthorizedApps(searchTerm.trim())
  const revoke = useRevokeAuthorizedApp()
  const [pendingRevokeClientId, setPendingRevokeClientId] = useState<string | null>(null)

  const list = apps.data?.pages.flatMap((page) => page.apps) ?? []
  const pendingRevoke = list.find((app) => app.clientId === pendingRevokeClientId) ?? null

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
          <SettingsQueryErrorState
            error={apps.error}
            fallback='Failed to load authorized apps'
            isRetrying={apps.isFetching}
            onRetry={() => apps.refetch()}
          />
        ) : apps.isPending ? (
          <SettingsEmptyState>Loading authorized apps…</SettingsEmptyState>
        ) : list.length === 0 ? (
          <SettingsEmptyState>
            {searchTerm.trim()
              ? `No apps found matching "${searchTerm}"`
              : 'No apps have access to your account'}
          </SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {list.map((app) => (
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
            {apps.isError && (
              <SettingsQueryErrorState
                error={apps.error}
                fallback='Failed to load authorized apps'
                isRetrying={apps.isFetching}
                onRetry={() => (apps.isFetchNextPageError ? apps.fetchNextPage() : apps.refetch())}
                variant='inline'
              />
            )}
            {apps.hasNextPage && !apps.isError && (
              <Chip fullWidth disabled={apps.isFetching} onClick={() => apps.fetchNextPage()}>
                {apps.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Chip>
            )}
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
