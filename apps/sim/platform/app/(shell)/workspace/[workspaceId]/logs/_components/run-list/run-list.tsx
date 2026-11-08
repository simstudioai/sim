'use client'

import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { SearchField } from '@sim/emcn/search-field'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ControlBar } from '@/platform/app/(shell)/_components/control-bar/control-bar'
import { ListEnd } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/list-end/list-end'
import {
  WorkspaceEmpty,
  WorkspacePage,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import {
  formatComputeUnits,
  formatDuration,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type {
  RunSummary,
  RunsData,
  WorkspaceRead,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useRevealedCount } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-list/run-list.module.css'
import {
  RUN_STATUS_LABEL,
  RunStatusText,
  RunTriggerLabel,
} from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import {
  RUN_SORTS,
  RUN_STATUSES,
  runListParams,
  serializeRunList,
} from '@/platform/lib/workspace-views'
import { formatRelativeTime } from '@/platform/shared/time'

const PAGE_SIZE = 50

const SORT_LABEL: Record<(typeof RUN_SORTS)[number], string> = {
  newest: 'Started newest first',
  oldest: 'Started oldest first',
  duration: 'Duration longest first',
  cu: 'Compute Units highest first',
}

function compareRuns(sort: (typeof RUN_SORTS)[number]) {
  return (left: RunSummary, right: RunSummary) => {
    switch (sort) {
      case 'oldest':
        return left.startedAt - right.startedAt
      case 'duration':
        return (right.durationMs ?? -1) - (left.durationMs ?? -1)
      case 'cu':
        return (right.cu ?? -1) - (left.cu ?? -1)
      default:
        return right.startedAt - left.startedAt
    }
  }
}

interface RunListActions {
  /** Bring runs that arrived after this snapshot into the list. */
  showIncoming: () => void
}

interface RunListProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  data: RunsData
  actions: RunListActions
}

/**
 * Every run in the workspace, newest first. A row opens the run's trace; filters and sort shape the
 * list, and new runs join only when the reader asks, so the list never moves under them.
 */
export function RunList({ data, actions, read }: RunListProps) {
  const search = useSearchParams()
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  const term = view.q.trim().toLowerCase()
  const workflows = [
    ...new Map(data.runs.map((run) => [run.workflow.id, run.workflow])).values(),
  ].sort((left, right) => left.name.localeCompare(right.name))
  const triggers = [...new Set(data.runs.map((run) => run.trigger.label))].sort()
  // A trigger or workflow no longer among the runs, from an old link, reads as all of them.
  const trigger = triggers.includes(view.trigger) ? view.trigger : 'all'
  const workflow = workflows.some((item) => item.id === view.workflow) ? view.workflow : 'all'
  const [revealed, revealMore] = useRevealedCount(
    `logs/${data.workspace.id}/${term}/${view.status}/${trigger}/${workflow}/${view.sort}`,
    PAGE_SIZE
  )
  const matches = data.runs
    .filter(
      (run) =>
        (view.status === 'all' || run.status === view.status) &&
        (trigger === 'all' || run.trigger.label === trigger) &&
        (workflow === 'all' || run.workflow.id === workflow) &&
        (!term || run.workflow.name.toLowerCase().includes(term) || run.id.includes(term))
    )
    .sort(compareRuns(view.sort))
  const base = workspacePath(data.workspace.id, 'logs')
  const runHref = (id: string) =>
    serializeRunList(platformHref(`${base}/${encodeURIComponent(id)}`, search), view)

  const controls = (data.runs.length > 0 || data.incoming.length > 0) && (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search runs'
          placeholder='Search workflow or run ID'
          value={view.q}
          onValueChange={(q) => void setView({ q: q || null })}
        />
      }
    >
      {data.incoming.length > 0 && (
        <Button variant='quiet' size='compact' icon='I065' onClick={actions.showIncoming}>
          {`${data.incoming.length} new ${data.incoming.length === 1 ? 'run' : 'runs'}`}
        </Button>
      )}
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
        options={[
          { value: 'all', label: 'All triggers' },
          ...triggers.map((trigger) => ({ value: trigger, label: trigger })),
        ]}
        value={trigger}
        onValueChange={(trigger) => void setView({ trigger: trigger === 'all' ? null : trigger })}
      />
      <ChoiceMenu
        label='Workflow'
        options={[
          { value: 'all', label: 'All workflows' },
          ...workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
        ]}
        value={workflow}
        onValueChange={(workflow) =>
          void setView({ workflow: workflow === 'all' ? null : workflow })
        }
      />
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
    <WorkspacePage read={read} workspace={data.workspace} current='logs' controls={controls}>
      {!data.runs.length && !data.incoming.length ? (
        <WorkspaceEmpty
          title='No runs yet'
          description='Runs appear here when a workflow in this workspace runs.'
        />
      ) : !matches.length ? (
        <WorkspaceEmpty
          title='No matching runs'
          description='Try another search or filter.'
          action={{ label: 'Clear filters', onClick: () => void setView(null) }}
        />
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
            {matches.slice(0, revealed).map((run) => (
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
                    `started ${formatRelativeTime(run.startedAt, data.referenceTime)}`,
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
                    {formatRelativeTime(run.startedAt, data.referenceTime)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <ListEnd hasMore={matches.length > revealed} onLoadMore={revealMore} />
        </div>
      )}
    </WorkspacePage>
  )
}
