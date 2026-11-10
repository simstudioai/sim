'use client'

import { EmptyState } from '@sim/emcn/empty-state'
import { FailureNotice } from '@sim/emcn/status'
import styles from '@/app/(product)/_components/workspace/knowledge/connector-history/connector-history.module.css'
import { useViewerTimeZone } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  type ConnectorData,
  getConnectorSyncState,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
  type MemberSyncLogData,
  type SyncLogData,
  useConnectorDetail,
} from '@/platform/lib/data/knowledge/connectors'
import { formatRelativeTime, formatTimestamp, LOCALE } from '@/platform/shared/time'

type LogState = 'running' | 'interrupted' | 'failed' | 'completed' | 'partial' | 'continuing'

const LOG_LABELS: Record<LogState, string> = {
  running: 'In progress…',
  interrupted: 'Interrupted',
  failed: 'Failed',
  completed: 'Completed',
  partial: 'Partial',
  continuing: 'Continuing',
}

/** A reclaimed stale lock leaves a started row behind; each engine judges it by its own TTL. */
function logState(
  log: Pick<SyncLogData, 'status' | 'startedAt'>,
  ttl: number,
  now: number | null
): LogState {
  if (log.status !== 'started') return log.status
  return now !== null && now - new Date(log.startedAt).getTime() > ttl ? 'interrupted' : 'running'
}

/** How long until a future run, at the coarsest unit that says it. */
function untilLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}hr${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}

function counted(count: number, one: string, many: string) {
  return `${count.toLocaleString(LOCALE)} ${count === 1 ? one : many}`
}

interface LogRowProps {
  startedAt: string
  state: LogState
  description?: string
  notice?: string | null
}

function LogRow({ startedAt, state, description, notice }: LogRowProps) {
  const timeZone = useViewerTimeZone()
  const detail = [description, notice].filter(Boolean).join(' · ')
  return (
    <li className={styles.row}>
      <span className={styles.copy}>
        <time dateTime={startedAt} data-type='T060'>
          {formatTimestamp(new Date(startedAt).getTime(), timeZone)}
        </time>
        {detail && (
          <span className={styles.detail} data-type='T052'>
            {detail}
          </span>
        )}
      </span>
      <span
        className={styles.state}
        data-state={state === 'failed' ? 'failed' : undefined}
        data-type='T052'
      >
        {LOG_LABELS[state]}
      </span>
    </li>
  )
}

function SyncLogs({ logs, now }: { logs: SyncLogData[]; now: number | null }) {
  if (logs.length === 0) return <EmptyState title='No sync history yet' />
  return (
    <ol className={styles.list} aria-label='Syncs'>
      {logs.map((log) => {
        const continuing =
          log.status === 'partial' &&
          log.listedCount === null &&
          log.docsFailed === 0 &&
          !log.errorMessage
        const state = continuing
          ? 'continuing'
          : logState(log, CONNECTOR_SYNC_STALE_LOCK_TTL_MS, now)
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
          <LogRow
            key={log.id}
            startedAt={log.startedAt}
            state={state}
            notice={state === 'failed' ? undefined : log.errorMessage}
            description={
              state === 'failed'
                ? (log.errorMessage ?? undefined)
                : state === 'completed' || state === 'partial' || state === 'continuing'
                  ? changes ||
                    (state === 'continuing' || log.errorMessage ? undefined : 'No changes')
                  : undefined
            }
          />
        )
      })}
    </ol>
  )
}

interface MemberLogsProps {
  logs: MemberSyncLogData[]
  suspended: number
  stale: number
  now: number | null
}

/** Several partial member runs can form one drain; they are not failed syncs. */
function MemberLogs({ logs, suspended, stale, now }: MemberLogsProps) {
  const warnings = [
    suspended > 0 &&
      `${suspended} ${suspended === 1 ? 'account needs' : 'accounts need'} reconnecting`,
    stale > 0 && `${counted(stale, 'account', 'accounts')} not synced recently`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <>
      {warnings && (
        <p className={styles.warning} data-type='T060' role='status'>
          {warnings}
        </p>
      )}
      {logs.length === 0 ? (
        <EmptyState title='No member sync history yet' />
      ) : (
        <ol className={styles.list} aria-label='Member syncs'>
          {logs.map((log) => {
            const continuing =
              log.status === 'partial' &&
              log.membersIncomplete > 0 &&
              log.membersFailed === 0 &&
              log.docsFailed === 0 &&
              log.processingDispatchFailed === 0 &&
              !log.errorMessage
            const state = continuing
              ? 'continuing'
              : logState(log, MEMBER_SYNC_STALE_LOCK_TTL_MS, now)
            const changes = [
              log.docsAdded > 0 && `${log.docsAdded} added`,
              log.docsUpdated > 0 && `${log.docsUpdated} updated`,
              log.docsTombstoned + log.docsPurged > 0 &&
                `${log.docsTombstoned + log.docsPurged} deleted`,
              (log.docsFailed ?? 0) > 0 && `${log.docsFailed} failed`,
              (log.processingDispatchFailed ?? 0) > 0 &&
                `${log.processingDispatchFailed} failed to queue`,
            ]
              .filter(Boolean)
              .join(' · ')
            const description = [
              changes || (continuing || log.errorMessage ? undefined : 'No changes'),
              log.membersFailed > 0 &&
                `${counted(log.membersFailed, 'account', 'accounts')} failed`,
              log.membersIncomplete > 0 &&
                `${counted(log.membersIncomplete, 'account', 'accounts')} incomplete`,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <LogRow
                key={log.id}
                startedAt={log.startedAt}
                state={state}
                notice={state === 'failed' ? undefined : log.errorMessage}
                description={
                  state === 'failed'
                    ? (log.errorMessage ?? undefined)
                    : state === 'completed' || state === 'partial' || state === 'continuing'
                      ? description
                      : undefined
                }
              />
            )
          })}
        </ol>
      )}
    </>
  )
}

interface ConnectorHistoryProps {
  knowledgeBaseId: string
  connector: ConnectorData
}

/**
 * A connector's sync history: when it last ran, how many documents it holds and when it runs next,
 * then each run with its outcome and what it changed. A per-member connector also says which
 * member accounts need attention.
 */
export function ConnectorHistory({ knowledgeBaseId, connector }: ConnectorHistoryProps) {
  const detail = useConnectorDetail(knowledgeBaseId, connector.id)
  const state = getConnectorSyncState(connector)
  const now = useMinuteClock()
  const nextAt = state.nextSyncAt ? new Date(state.nextSyncAt).getTime() : null
  const nextSync =
    nextAt !== null && now !== null && connector.status === 'active' && !state.syncInFlight
      ? nextAt <= now
        ? 'Next sync pending'
        : `Next sync ${untilLabel(nextAt - now)}`
      : undefined
  const summary = [
    state.lastSyncAt &&
      `Last sync ${formatRelativeTime(new Date(state.lastSyncAt).getTime(), now)}`,
    !state.syncsPerMember &&
      connector.lastSyncDocCount !== null &&
      counted(connector.lastSyncDocCount, 'document', 'documents'),
    nextSync,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={styles.history}>
      {summary && (
        <p className={styles.summary} data-type='T060'>
          {summary}
        </p>
      )}
      {state.lastSyncError && (
        <p className={styles.error} data-type='T060' role='status'>
          {state.lastSyncError}
        </p>
      )}
      {detail.isError ? (
        <FailureNotice
          message='Could not load sync history.'
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      ) : detail.isLoading ||
        detail.isPlaceholderData ||
        !detail.data ? null : state.syncsPerMember ? (
        <MemberLogs
          logs={detail.data.memberSyncLogs ?? []}
          suspended={detail.data.members?.suspended ?? 0}
          stale={detail.data.members?.stale ?? 0}
          now={now}
        />
      ) : (
        <SyncLogs logs={detail.data.syncLogs ?? []} now={now} />
      )}
    </div>
  )
}
