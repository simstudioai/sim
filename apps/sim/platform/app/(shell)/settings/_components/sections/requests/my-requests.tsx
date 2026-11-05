'use client'

import { useState } from 'react'
import { MyRequestModal } from '@/platform/app/(shell)/settings/_components/sections/requests/my-request-modal'
import { RequestAccessModal } from '@/platform/app/(shell)/settings/_components/sections/requests/request-access-modal'
import styles from '@/platform/app/(shell)/settings/_components/sections/requests/requests.module.css'
import {
  Button,
  EmptyState,
  InlineNotice,
  Pagination,
  SearchField,
  StatusTag,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { RequestScope, RequestTarget, useMyRequests } from '@/platform/lib/data/requests'
import { useRequestsUrl } from '@/platform/lib/data/requests'

interface MyRequestsProps {
  scope: RequestScope
  view: 'requests' | 'catalog'
  mine: ReturnType<typeof useMyRequests>
}

export function MyRequests({ scope, view, mine }: MyRequestsProps) {
  const { params, setParams } = useRequestsUrl(false)
  const [asking, setAsking] = useState<{ target: RequestTarget; label: string } | null>(null)
  const [searchEpoch, setSearchEpoch] = useState(0)
  const viewRequest = (requestId: string) => void setParams({ requestId }, { history: 'push' })
  return (
    <>
      {view === 'catalog' && mine.hasOrganization && (
        <SearchField
          key={searchEpoch}
          label='Search access'
          placeholder='Search features, integrations, and models...'
          defaultValue={mine.search}
          onValueChange={mine.setSearch}
        />
      )}
      {mine.paused && (
        <InlineNotice message='Your organization has paused new requests. Your request history is still available.' />
      )}
      {mine.searching || mine.loading ? (
        <p className={styles.status} role='status' data-type='T060'>
          Loading…
        </p>
      ) : mine.error ? (
        <InlineNotice
          intent='danger'
          title='Unable to load access requests'
          message={mine.error.message}
          action={
            <Button size='compact' disabled={mine.fetching} onClick={mine.retry}>
              Retry
            </Button>
          }
        />
      ) : view === 'requests' ? (
        mine.rows.length === 0 ? (
          <EmptyState
            title={mine.page > 0 ? 'No requests on this page' : 'No requests yet'}
            description={
              mine.page > 0
                ? 'Go to the previous page to see your requests.'
                : 'Requests you send will appear here.'
            }
          />
        ) : (
          <SettingsSurface>
            {mine.rows.map((row) => (
              <SettingsRow key={row.id} label={row.title} description={row.date}>
                <span className={styles.controls}>
                  <StatusTag label={row.status.label} intent={row.status.intent} />
                  <Button size='compact' variant='quiet' onClick={() => viewRequest(row.id)}>
                    View
                  </Button>
                </span>
              </SettingsRow>
            ))}
          </SettingsSurface>
        )
      ) : !mine.hasOrganization ? (
        <EmptyState title='Access requests are available in organization workspaces.' />
      ) : mine.entries.length === 0 ? (
        <EmptyState
          title={
            mine.query
              ? 'No matching results'
              : mine.page > 0
                ? 'No more access to request'
                : 'Nothing to request in this organization'
          }
          action={
            mine.query ? (
              <Button
                onClick={() => {
                  mine.setSearch('')
                  setSearchEpoch((epoch) => epoch + 1)
                }}
              >
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <SettingsSurface>
          {mine.entries.map((entry) => (
            <SettingsRow key={entry.key} label={entry.label}>
              <span className={styles.controls}>
                {entry.state === 'allowed' && <StatusTag label='Available' />}
                {entry.state === 'requestable' && entry.pendingRequestId ? (
                  <Button size='compact' onClick={() => viewRequest(entry.pendingRequestId ?? '')}>
                    View request
                  </Button>
                ) : (
                  entry.state === 'requestable' &&
                  mine.catalogEnabled && (
                    <Button
                      size='compact'
                      onClick={() => setAsking({ target: entry.target, label: entry.label })}
                    >
                      {entry.target.kind === 'usage_limit' ? 'Request increase' : 'Request access'}
                    </Button>
                  )
                )}
              </span>
            </SettingsRow>
          ))}
        </SettingsSurface>
      )}
      {(mine.page > 0 || mine.hasMore) && (
        <Pagination
          label='Access requests pages'
          page={mine.page + 1}
          hasNext={mine.hasMore}
          disabled={mine.fetching || mine.searching}
          onPageChange={(next) => mine.setPage(next - 1)}
        />
      )}
      {params.requestId && (
        <MyRequestModal
          key={params.requestId}
          scope={scope}
          requestId={params.requestId}
          onClose={() => void setParams({ requestId: null })}
        />
      )}
      {asking && (
        <RequestAccessModal
          scope={scope}
          target={asking.target}
          label={asking.label}
          onViewRequest={viewRequest}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  )
}
