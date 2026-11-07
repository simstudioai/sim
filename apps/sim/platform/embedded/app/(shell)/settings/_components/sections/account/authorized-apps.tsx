'use client'

import { useState } from 'react'
import {
  ActionMenu,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FailureNotice,
  QueryBoundary,
  SectionSearch,
} from '@/platform/design-system/components'
import { SectionSkeleton } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useAuthorizedAppsList } from '@/platform/shared/account'

const TITLE = 'Authorized apps'
const COLUMNS = [
  { key: 'name', label: 'App', kind: 'text' },
  { key: 'access', label: 'Access', kind: 'text', showFrom: 'compact' },
  { key: 'authorized', label: 'Authorized', kind: 'text' },
] as const

/**
 * Apps this account authorized through Sim. Revoking one withdraws its consent and kills every token
 * it holds, so its next request fails and its next sign-in asks again.
 */
export function AuthorizedApps() {
  const list = useAuthorizedAppsList()
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
  return (
    <>
      <SectionSearch subject='authorized apps' value={list.search} onValueChange={list.setSearch} />
      {list.refreshFailed && (
        <FailureNotice
          message={list.error ?? 'Failed to refresh authorized apps'}
          onRetry={list.retry}
        />
      )}
      <QueryBoundary
        query={{
          data: list.status === 'error' || list.status === 'pending' ? undefined : list.apps,
          error: list.status === 'error',
          refetch: list.retry,
        }}
        failure={list.error ?? 'Failed to load authorized apps'}
        loadingLabel={`Loading ${TITLE}`}
        loading={<SectionSkeleton title={TITLE} rows={2} />}
      >
        {() =>
          list.apps.length === 0 ? (
            <EmptyState
              title={
                list.term
                  ? `No apps found matching "${list.term}"`
                  : 'No apps have access to your account'
              }
            />
          ) : (
            <DataTable
              title={TITLE}
              titleHidden
              columns={COLUMNS}
              loadMore={list.loadMore}
              rows={list.apps.map((app) => ({
                id: app.id,
                values: { name: app.name, access: app.access, authorized: app.authorized },
                action: (
                  <ActionMenu
                    label={`${app.name} actions`}
                    icon='I108'
                    align='end'
                    actions={[
                      {
                        id: 'revoke',
                        label: 'Revoke',
                        destructive: true,
                        onSelect: () => setRevoking({ id: app.id, name: app.name }),
                      },
                    ]}
                  />
                ),
              }))}
            />
          )
        }
      </QueryBoundary>
      <ConfirmDialog
        target={revoking !== null}
        onClose={() => setRevoking(null)}
        title='Revoke access'
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        description={`Revoking ${revoking?.name ?? 'this app'} immediately signs it out everywhere. You will have to authorize it again to reconnect.`}
        onConfirm={() => (revoking ? list.revoke(revoking.id, revoking.name) : undefined)}
      />
    </>
  )
}
