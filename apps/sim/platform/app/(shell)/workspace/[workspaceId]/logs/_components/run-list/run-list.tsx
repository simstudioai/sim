'use client'

import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import {
  ListEnd,
  type ListEndProps,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end'
import {
  WorkspaceEmpty,
  WorkspaceTabPage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import {
  formatComputeUnits,
  formatDuration,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list.module.css'
import {
  RUN_STATUS_LABEL,
  RunStatusText,
  RunTriggerLabel,
} from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import {
  RUN_PERIODS,
  RUN_SORTS,
  RUN_STATUSES,
  runListParams,
  serializeRunList,
} from '@/platform/lib/workspace-views'
import { formatRelativeTime } from '@/platform/shared/time'
import type { RunSummary, TabWorkspace } from '@/platform/shared/workspace-records'

const SORT_LABEL: Record<(typeof RUN_SORTS)[number], string> = {
  newest: 'Started newest first',
  oldest: 'Started oldest first',
  duration: 'Duration longest first',
  cu: 'Compute Units highest first',
}

const PERIOD_LABEL: Record<(typeof RUN_PERIODS)[number], string> = {
  all: 'All time',
  '1h': 'Past hour',
  '24h': 'Past 24 hours',
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
}

export interface RunFilterOption {
  value: string
  label: string
}

interface RunListProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  workspace: TabWorkspace
  /** The surface's single reference instant for start ages. */
  referenceTime: number
  /** The runs the view's period, filters and sort select, in order, as far as they have been read. */
  runs: readonly RunSummary[]
  /** What the Trigger and Workflow filters offer. */
  triggers: readonly RunFilterOption[]
  workflows: readonly RunFilterOption[]
  /** Reading further down the list; the page refreshes itself, so new runs join on their own. */
  more: ListEndProps
}

/**
 * Every run in the workspace, newest first. A row opens the run's trace; the period, filters and
 * sort live in the URL and shape the list, and new runs join as the page refreshes.
 */
export function RunList({
  read,
  workspace,
  referenceTime,
  runs,
  triggers,
  workflows,
  more,
}: RunListProps) {
  const search = useSearchParams()
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  const filtered =
    view.period !== 'all' ||
    view.status !== 'all' ||
    view.trigger !== 'all' ||
    view.workflow !== 'all'
  const base = workspacePath(workspace.id, 'logs')
  const runHref = (id: string) =>
    serializeRunList(platformHref(`${base}/${encodeURIComponent(id)}`, search), view)

  const controls = (runs.length > 0 || filtered) && (
    <ControlBar
      leading={
        <>
          <ChoiceMenu
            label='Status'
            options={RUN_STATUSES.map((status) => ({
              value: status,
              label: status === 'all' ? 'All statuses' : RUN_STATUS_LABEL[status],
            }))}
            value={view.status}
            onValueChange={(status) =>
              void setView({
                status: RUN_STATUSES.find((value) => value === status && value !== 'all') ?? null,
              })
            }
          />
          <ChoiceMenu
            label='Trigger'
            options={[{ value: 'all', label: 'All triggers' }, ...triggers]}
            value={triggers.some((option) => option.value === view.trigger) ? view.trigger : 'all'}
            onValueChange={(trigger) =>
              void setView({ trigger: trigger === 'all' ? null : trigger })
            }
          />
          <ChoiceMenu
            label='Workflow'
            options={[{ value: 'all', label: 'All workflows' }, ...workflows]}
            value={
              workflows.some((option) => option.value === view.workflow) ? view.workflow : 'all'
            }
            onValueChange={(workflow) =>
              void setView({ workflow: workflow === 'all' ? null : workflow })
            }
          />
          <ChoiceMenu
            label='Period'
            options={RUN_PERIODS.map((period) => ({ value: period, label: PERIOD_LABEL[period] }))}
            value={view.period}
            onValueChange={(period) =>
              void setView({
                period: RUN_PERIODS.find((value) => value === period && value !== 'all') ?? null,
              })
            }
          />
        </>
      }
    >
      <ActionMenu
        label='Sort runs'
        icon='I050'
        tooltip
        actions={RUN_SORTS.map((sort) => ({
          id: sort,
          label: SORT_LABEL[sort],
          checked: view.sort === sort,
          onSelect: () => void setView({ sort: sort === 'newest' ? null : sort }),
        }))}
      />
    </ControlBar>
  )

  return (
    <WorkspaceTabPage read={read} workspace={workspace} current='logs' controls={controls}>
      {!runs.length ? (
        filtered ? (
          <WorkspaceEmpty
            title='No matching runs'
            description='Try another period, status, trigger or workflow.'
            action={{ label: 'Clear filters', onClick: () => void setView(null) }}
          />
        ) : (
          <WorkspaceEmpty
            title='No runs yet'
            description='Runs appear here when a workflow in this workspace runs.'
          />
        )
      ) : (
        <div className={styles.table}>
          <div className={styles.header} data-type='T050' aria-hidden='true'>
            <span>Workflow</span>
            <span>Status</span>
            <span data-optional=''>Trigger</span>
            <span className={styles.numeric}>Duration</span>
            <span className={styles.numeric} data-optional=''>
              Compute Units
            </span>
            <span className={styles.numeric}>Started</span>
          </div>
          <ol className={styles.rows} aria-label='Runs'>
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={runHref(run.id)}
                  className={styles.row}
                  aria-label={[
                    run.workflow.name,
                    RUN_STATUS_LABEL[run.status],
                    `trigger ${run.trigger.label}`,
                    `duration ${formatDuration(run.durationMs)}`,
                    run.cu === null
                      ? 'Compute Units unknown'
                      : `${formatComputeUnits(run.cu)} Compute Units`,
                    `started ${formatRelativeTime(run.startedAt, referenceTime)}`,
                  ].join(', ')}
                >
                  <span className={styles.workflow} data-type='T060'>
                    <OverflowText text={run.workflow.name}>{run.workflow.name}</OverflowText>
                  </span>
                  <span data-type='T060'>
                    <RunStatusText status={run.status} />
                  </span>
                  <span className={styles.secondary} data-type='T060' data-optional=''>
                    <RunTriggerLabel trigger={run.trigger} />
                  </span>
                  <span className={styles.number} data-type='T060'>
                    {formatDuration(run.durationMs)}
                  </span>
                  <span className={styles.number} data-type='T060' data-optional=''>
                    {formatComputeUnits(run.cu, 'compact')}
                  </span>
                  <span className={styles.number} data-type='T060'>
                    {formatRelativeTime(run.startedAt, referenceTime)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <ListEnd
            hasMore={more.hasMore}
            onLoadMore={more.onLoadMore}
            loading={more.loading}
            error={more.error}
          />
        </div>
      )}
    </WorkspaceTabPage>
  )
}
