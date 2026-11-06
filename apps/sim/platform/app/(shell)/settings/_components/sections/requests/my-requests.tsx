'use client'

import { useState } from 'react'
import { ACCESS_REQUEST_MAX_SEARCH_LENGTH } from '@/ee/access-requests/lib/constants'
import { MyRequestModal } from '@/platform/app/(shell)/settings/_components/sections/requests/my-request-modal'
import { RequestAccessModal } from '@/platform/app/(shell)/settings/_components/sections/requests/request-access-modal'
import styles from '@/platform/app/(shell)/settings/_components/sections/requests/requests.module.css'
import {
  Button,
  EmptyState,
  errorMessageOr,
  Icon,
  InlineNotice,
  Pagination,
  QueryBoundary,
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
  const viewRequest = (requestId: string) => void setParams({ requestId }, { history: 'push' })
  return (
    <>
      {view === 'catalog' && mine.hasOrganization && (
        <SearchField
          label='Search access'
          placeholder='Search features, integrations, and models…'
          value={mine.search}
          onValueChange={mine.setSearch}
          maxLength={ACCESS_REQUEST_MAX_SEARCH_LENGTH}
        />
      )}
      {mine.paused && (
        <InlineNotice message='Your organization has paused new requests. Your request history is still available.' />
      )}
      {view === 'requests' ? (
        <QueryBoundary
          query={mine.rowsRead}
          failure={errorMessageOr('The request is unavailable.')}
          failureTitle='Unable to load access requests'
          loadingLabel='Loading access requests'
          empty={(rows) =>
            rows.length === 0 && (
              <EmptyState
                title={mine.page > 0 ? 'No requests on this page' : 'No requests yet'}
                description={
                  mine.page > 0
                    ? 'Go to the previous page to see your requests.'
                    : 'Requests you send will appear here.'
                }
              />
            )
          }
        >
          {(rows) => (
            <SettingsSurface>
              {rows.map((row) => (
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
          )}
        </QueryBoundary>
      ) : (
        <QueryBoundary
          query={mine.entriesRead}
          failure={errorMessageOr('The request is unavailable.')}
          failureTitle='Unable to load access requests'
          loadingLabel='Loading access requests'
          empty={(entries) =>
            !mine.hasOrganization ? (
              <EmptyState title='Access requests are available in organization workspaces.' />
            ) : (
              entries.length === 0 && (
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
              )
            )
          }
        >
          {(entries) => (
            <SettingsSurface>
              {entries.map((entry) => (
                <SettingsRow
                  key={entry.key}
                  label={entry.label}
                  leading={entry.state === 'allowed' ? undefined : <Icon name='I137' />}
                >
                  <span className={styles.controls}>
                    {entry.state === 'allowed' && <StatusTag label='Available' />}
                    {entry.state === 'requestable' && entry.pendingRequestId ? (
                      <Button
                        size='compact'
                        onClick={() => viewRequest(entry.pendingRequestId ?? '')}
                      >
                        View request
                      </Button>
                    ) : (
                      entry.state === 'requestable' &&
                      mine.catalogEnabled && (
                        <Button
                          size='compact'
                          onClick={() => setAsking({ target: entry.target, label: entry.label })}
                        >
                          {entry.target.kind === 'usage_limit'
                            ? 'Request increase'
                            : 'Request access'}
                        </Button>
                      )
                    )}
                  </span>
                </SettingsRow>
              ))}
            </SettingsSurface>
          )}
        </QueryBoundary>
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
