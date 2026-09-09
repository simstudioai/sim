'use client'

import { CircleCheck, CircleX, Loader, TriangleAlert, Users } from '@sim/emcn/icons'
import { format } from 'date-fns'
import type {
  ConnectorData,
  ConnectorDetailData,
  ConnectorMemberSummary,
  MemberSyncLogData,
  SyncLogData,
} from '@/lib/api/contracts/knowledge/connectors'
import {
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
} from '@/lib/knowledge/connectors/sync-limits'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useConnectorDetail } from '@/hooks/queries/kb/connectors'

interface ConnectorSyncHistoryProps {
  connector: ConnectorData
  knowledgeBaseId: string
  detail?: ConnectorDetailData
}

export function ConnectorSyncHistory({
  connector,
  knowledgeBaseId,
  detail,
}: ConnectorSyncHistoryProps) {
  const query = useConnectorDetail(
    detail ? undefined : knowledgeBaseId,
    detail ? undefined : connector.id
  )
  const isLoading = !detail && (query.isLoading || query.isPlaceholderData)
  const data = detail ?? query.data
  if (!detail && query.isError) {
    return (
      <SettingsQueryErrorState
        error={query.error}
        fallback='Could not load sync history'
        isRetrying={query.isFetching}
        onRetry={() => void query.refetch()}
        variant='inline'
      />
    )
  }
  return connector.accessMode === 'members' ? (
    <MemberSyncHistory
      logs={isLoading ? [] : (data?.memberSyncLogs ?? [])}
      members={isLoading ? undefined : data?.members}
      isLoading={isLoading}
    />
  ) : (
    <SyncHistory logs={isLoading ? [] : (data?.syncLogs ?? [])} isLoading={isLoading} />
  )
}

type SyncLogState = 'running' | 'interrupted' | 'failed' | 'completed' | 'partial'

const SYNC_LOG_LABELS: Record<SyncLogState, string> = {
  running: 'In progress…',
  interrupted: 'Interrupted',
  failed: 'Failed',
  completed: 'Completed',
  partial: 'Partial',
}

/** Reclaimed stale locks leave started log rows behind; both views use the engine's own TTL. */
function getSyncLogState(
  log: Pick<SyncLogData, 'status' | 'startedAt'>,
  staleLockTtl: number,
  now: number
): SyncLogState {
  switch (log.status) {
    case 'completed':
    case 'partial':
    case 'failed':
      return log.status
    case 'started':
      return now - new Date(log.startedAt).getTime() > staleLockTtl ? 'interrupted' : 'running'
  }
}

interface SyncHistoryRowProps {
  startedAt: string
  state: SyncLogState
  description?: string
}

function SyncHistoryRow({ startedAt, state, description }: SyncHistoryRowProps) {
  const icon =
    state === 'running' ? (
      <Loader animate />
    ) : state === 'interrupted' || state === 'partial' ? (
      <TriangleAlert />
    ) : state === 'failed' ? (
      <CircleX />
    ) : (
      <CircleCheck />
    )
  return (
    <SettingsResourceRow
      icon={icon}
      iconVariant='plain'
      title={`${format(new Date(startedAt), 'MMM d, h:mm a')} · ${SYNC_LOG_LABELS[state]}`}
      description={description}
    />
  )
}

interface SyncHistoryProps {
  logs: SyncLogData[]
  isLoading: boolean
}

export function SyncHistory({ logs, isLoading }: SyncHistoryProps) {
  if (isLoading)
    return <SettingsEmptyState variant='inline'>Loading sync history…</SettingsEmptyState>
  if (logs.length === 0)
    return <SettingsEmptyState variant='inline'>No sync history yet.</SettingsEmptyState>

  const now = Date.now()
  return (
    <div className={RESOURCE_LIST_STACK}>
      {logs.map((log) => {
        const state = getSyncLogState(log, CONNECTOR_SYNC_STALE_LOCK_TTL_MS, now)
        const changes = [
          log.docsAdded > 0 && `${log.docsAdded} added`,
          log.docsUpdated > 0 && `${log.docsUpdated} updated`,
          log.docsDeleted > 0 && `${log.docsDeleted} deleted`,
          log.docsFailed > 0 && `${log.docsFailed} failed`,
          log.docsSkipped > 0 && `${log.docsSkipped} skipped`,
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <SyncHistoryRow
            key={log.id}
            startedAt={log.startedAt}
            state={state}
            description={
              state === 'failed'
                ? (log.errorMessage ?? undefined)
                : state === 'completed' || state === 'partial'
                  ? changes || 'No changes'
                  : undefined
            }
          />
        )
      })}
    </div>
  )
}

interface MemberSyncHistoryProps {
  logs: MemberSyncLogData[]
  members: ConnectorMemberSummary | undefined
  isLoading: boolean
}

/** Several partial member runs can form one drain; they are not failed syncs. */
function MemberSyncHistory({ logs, members, isLoading }: MemberSyncHistoryProps) {
  if (isLoading)
    return <SettingsEmptyState variant='inline'>Loading member sync history…</SettingsEmptyState>

  const now = Date.now()
  return (
    <div className={RESOURCE_LIST_STACK}>
      {members && (
        <SettingsResourceRow
          icon={<Users />}
          iconVariant='plain'
          title={`${members.active} connected`}
          description={
            [
              members.suspended > 0 && `${members.suspended} need reconnecting`,
              members.stale > 0 && `${members.stale} not synced recently`,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
      )}
      {logs.length === 0 ? (
        <SettingsEmptyState variant='inline'>No member sync history yet.</SettingsEmptyState>
      ) : (
        logs.map((log) => {
          const state = getSyncLogState(log, MEMBER_SYNC_STALE_LOCK_TTL_MS, now)
          const processed = log.membersCompleted + log.membersIncomplete + log.membersFailed
          const changes = [
            log.docsAdded > 0 && `${log.docsAdded} added`,
            log.docsUpdated > 0 && `${log.docsUpdated} updated`,
            log.docsTombstoned + log.docsPurged > 0 &&
              `${log.docsTombstoned + log.docsPurged} deleted`,
          ]
            .filter(Boolean)
            .join(' · ')
          const description = [
            `${processed} ${processed === 1 ? 'member' : 'members'}`,
            log.membersFailed > 0 && `${log.membersFailed} failed`,
            changes || 'No changes',
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <SyncHistoryRow
              key={log.id}
              startedAt={log.startedAt}
              state={state}
              description={
                state === 'failed'
                  ? (log.errorMessage ?? undefined)
                  : state === 'completed' || state === 'partial'
                    ? description
                    : undefined
              }
            />
          )
        })
      )}
    </div>
  )
}
