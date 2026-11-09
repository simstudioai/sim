'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Pagination } from '@sim/emcn/pagination'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import styles from '@/platform/app/(shell)/_components/access-requests/access-requests.module.css'
import { MyRequestModal } from '@/platform/app/(shell)/_components/access-requests/my-request-modal'
import { RequestAccessModal } from '@/platform/app/(shell)/_components/request-access-modal/request-access-modal'
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
  const viewRequest = (requestId: string) => void setParams({ requestId }, { history: 'push' })
  return (
    <>
      {view === 'catalog' && mine.hasOrganization && (
        <SearchField
          label='Search access'
          placeholder='Search features, integrations, and models...'
          value={mine.search}
          onValueChange={mine.setSearch}
        />
      )}
      {mine.paused && (
        <InlineNotice message='Your organization has paused new requests. Your request history is still available.' />
      )}
      {mine.searching || mine.loading ? null : mine.error ? (
        <FailureNotice
          title='Unable to load access requests'
          message={mine.error.message}
          retrying={mine.fetching}
          onRetry={mine.retry}
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
              <Button onClick={() => mine.setSearch('')}>Clear search</Button>
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
