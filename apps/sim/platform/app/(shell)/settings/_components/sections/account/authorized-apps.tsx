'use client'

import { useState } from 'react'
import { SectionSkeleton } from '@/platform/app/(shell)/settings/_components/section-skeleton/section-skeleton'
import {
  ActionMenu,
  Button,
  DataTable,
  EmptyState,
  InlineNotice,
  Modal,
  SearchField,
} from '@/platform/design-system/components'
import { useAuthorizedAppsList } from '@/platform/lib/data/account'

const TITLE = 'Authorized apps'
const COLUMNS = [
  { key: 'name', label: 'App', kind: 'text' },
  { key: 'access', label: 'Access', kind: 'text', showFrom: 'compact' },
  { key: 'authorized', label: 'Authorized', kind: 'text', showFrom: 'wide' },
] as const

/**
 * Apps this account authorized through Sim. Revoking one withdraws its consent and kills every token
 * it holds, so its next request fails and its next sign-in asks again.
 */
export function AuthorizedApps() {
  const list = useAuthorizedAppsList()
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
  if (list.status === 'error')
    return (
      <InlineNotice
        intent='danger'
        message={list.error ?? 'Failed to load authorized apps'}
        action={
          <Button variant='quiet' size='compact' onClick={list.retry}>
            Retry
          </Button>
        }
      />
    )
  return (
    <>
      <SearchField
        label='Search authorized apps'
        placeholder='Search authorized apps…'
        defaultValue={list.search}
        onValueChange={list.setSearch}
      />
      {list.status === 'pending' ? (
        <SectionSkeleton title={TITLE} rows={2} />
      ) : list.apps.length === 0 ? (
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
          columns={COLUMNS}
          loadMore={list.loadMore}
          rows={list.apps.map((app) => ({
            id: app.id,
            values: { name: app.name, access: app.access, authorized: app.authorized },
            action: (
              <ActionMenu
                label={`${app.name} actions`}
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
      )}
      <Modal
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        variant='confirm'
        destructive
        title='Revoke access'
        confirmLabel='Revoke'
        description={`Revoking ${revoking?.name ?? 'this app'} immediately signs it out everywhere. You will have to authorize it again to reconnect.`}
        onConfirm={() => (revoking ? list.revoke(revoking.id, revoking.name) : undefined)}
      />
    </>
  )
}
