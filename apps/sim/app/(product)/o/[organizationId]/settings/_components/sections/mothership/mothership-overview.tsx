'use client'

import { DataTable, MetricGroup } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { OverlayDialog } from '@sim/emcn/modal/overlay-dialog'
import { Pagination } from '@sim/emcn/pagination'
import { PropertyList } from '@sim/emcn/property-list'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { type MothershipEnv, useMothershipOverview } from '@/platform/lib/data/mothership-admin'
import { formatTimestamp } from '@/platform/shared/time'

const USER_COLUMNS = [
  { key: 'user', label: 'User ID', kind: 'text' },
  { key: 'requests', label: 'Requests', kind: 'number' },
  { key: 'cost', label: 'Cost', kind: 'currency', currency: 'USD' },
  { key: 'time', label: 'Last request (UTC)', kind: 'text', showFrom: 'compact' },
] as const
const REQUEST_COLUMNS = [
  { key: 'id', label: 'Request ID', kind: 'text' },
  { key: 'model', label: 'Model', kind: 'text', showFrom: 'compact' },
  { key: 'cost', label: 'Cost', kind: 'currency', currency: 'USD', showFrom: 'compact' },
  { key: 'status', label: 'Status', kind: 'status' },
] as const
const PAGE_SIZE = 10

function cost(amount: number) {
  return `$${amount.toFixed(4)}`
}

interface OverviewProps {
  env: MothershipEnv
  start: string
  end: string
  /** The page of recent requests, from 1. */
  page: number
  /** The open request's id, or empty. */
  selected: string
  onPageChange: (page: number) => void
  onOpenRequest: (requestId: string) => void
  onCloseRequest: () => void
}

export function MothershipOverview({
  env,
  start,
  end,
  page,
  selected,
  onPageChange,
  onOpenRequest,
  onCloseRequest,
}: OverviewProps) {
  const { breakdown, requests } = useMothershipOverview(env, start, end)
  const summary = breakdown.data
  const totalCost = summary?.users.reduce((total, user) => total + user.total_cost, 0) ?? 0
  const records = requests.data?.requests.slice(0, 100) ?? []
  const active = records.find((request) => request.request_id === selected)
  const stateOf = (row: (typeof records)[number]) =>
    row.error ? 'Error' : row.aborted ? 'Aborted' : 'OK'
  const pageCount = Math.ceil(records.length / PAGE_SIZE)
  const currentPage = Math.min(page, pageCount) || 1
  return (
    <SectionStack>
      {summary ? (
        <>
          <MetricGroup
            metrics={[
              { label: 'Total requests', value: summary.total_requests },
              { label: 'Unique users', value: summary.total_users },
              { label: 'Total cost', value: cost(totalCost) },
              {
                label: 'Average cost per request',
                value: summary.total_requests ? cost(totalCost / summary.total_requests) : '—',
              },
            ]}
          />
          {summary.users.length ? (
            <DataTable
              title='User breakdown'
              columns={USER_COLUMNS}
              rows={summary.users.map((user) => ({
                id: user.user_id,
                values: {
                  user: user.user_id,
                  requests: user.request_count,
                  cost: user.total_cost,
                  time: user.last_request
                    ? formatTimestamp(Date.parse(user.last_request), 'UTC')
                    : '—',
                },
                cells: { cost: cost(user.total_cost) },
              }))}
            />
          ) : (
            <EmptyState title='No users in this period' />
          )}
        </>
      ) : breakdown.status === 'error' ? (
        <FailureNotice message='Couldn’t load user activity.' onRetry={breakdown.retry} />
      ) : null}
      {requests.data ? (
        records.length ? (
          <>
            <DataTable
              title={`Recent requests (${requests.data.count})`}
              columns={REQUEST_COLUMNS}
              rows={records
                .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                .map((row) => ({
                  id: row.request_id,
                  values: { id: row.request_id, model: row.model, cost: row.billed_total_cost },
                  cells: {
                    cost: cost(row.billed_total_cost ?? 0),
                    status: (
                      <StatusTag
                        label={stateOf(row)}
                        intent={row.error ? 'danger' : row.aborted ? 'warning' : 'success'}
                      />
                    ),
                  },
                  onOpen: () => onOpenRequest(row.request_id),
                }))}
            />
            {active && (
              <OverlayDialog open title={active.request_id} onClose={onCloseRequest}>
                <PropertyList
                  titleHidden
                  title='Request details'
                  properties={[
                    { id: 'model', kind: 'text', label: 'Model', value: active.model ?? '—' },
                    {
                      id: 'duration',
                      kind: 'text',
                      label: 'Duration',
                      value:
                        active.duration_ms == null
                          ? '—'
                          : `${(active.duration_ms / 1000).toFixed(1)} s`,
                    },
                    {
                      id: 'cost',
                      kind: 'text',
                      label: 'Cost',
                      value: cost(active.billed_total_cost ?? 0),
                    },
                    {
                      id: 'tools',
                      kind: 'text',
                      label: 'Tool calls',
                      value: String(active.tool_call_count ?? 0),
                    },
                    { id: 'status', kind: 'text', label: 'Status', value: stateOf(active) },
                    {
                      id: 'time',
                      kind: 'text',
                      label: 'Time (UTC)',
                      value: formatTimestamp(Date.parse(active.created_at), 'UTC'),
                    },
                  ]}
                />
              </OverlayDialog>
            )}
            {pageCount > 1 && (
              <Pagination
                label='Recent request pages'
                page={currentPage}
                pageCount={pageCount}
                onPageChange={onPageChange}
              />
            )}
          </>
        ) : (
          <EmptyState
            title='No recent requests'
            description='Choose a different environment or reporting period.'
          />
        )
      ) : requests.status === 'error' ? (
        <FailureNotice message='Couldn’t load recent requests.' onRetry={requests.retry} />
      ) : null}
    </SectionStack>
  )
}
