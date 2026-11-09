'use client'

import { type ReactNode, useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu, ContextActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { workspacePath } from '@/lib/navigation/paths'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import {
  ListEnd,
  type ListEndProps,
} from '@/app/(product)/workspace/[workspaceId]/_components/list-end/list-end'
import {
  WorkspaceEmpty,
  WorkspaceTabPage,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import {
  formatComputeUnits,
  formatDuration,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import { useRevealRow } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import styles from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-list/run-list.module.css'
import {
  RUN_STATUS_LABEL,
  RunStatusText,
  RunTriggerLabel,
} from '@/app/(product)/workspace/[workspaceId]/logs/_components/run-status/run-status'
import { platformHref } from '@/platform/lib/navigation'
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
  '30m': 'Past 30 minutes',
  '1h': 'Past hour',
  '6h': 'Past 6 hours',
  '12h': 'Past 12 hours',
  '24h': 'Past 24 hours',
  '3d': 'Past 3 days',
  '7d': 'Past 7 days',
  '14d': 'Past 14 days',
  '30d': 'Past 30 days',
  custom: 'Custom range',
}

const VIEW_OPTIONS = [
  { value: 'runs', label: 'Runs' },
  { value: 'dashboard', label: 'Dashboard' },
] as const

export interface RunFilterOption {
  value: string
  label: string
}

/** A row's own commands, around the copy actions every row has. */
export interface RunRowActions {
  /** Retry or stop the run, first in the menu. */
  commands: readonly MenuAction[]
  /** Open its workflow or snapshot, after the copy actions. */
  links: readonly MenuAction[]
}

interface RunListProps {
  /** How the page's read stands; ready when omitted. */
  read?: WorkspaceRead
  workspace: TabWorkspace
  /** The surface's single reference instant for start ages. */
  referenceTime: number
  /** The runs the view's period, filters and sort select, in order, as far as they have been read. */
  runs: readonly RunSummary[]
  /** What the Trigger, Workflow and Folder filters offer; no folders leaves the Folder filter out. */
  triggers: readonly RunFilterOption[]
  workflows: readonly RunFilterOption[]
  folders?: readonly RunFilterOption[]
  /** Reading further down the list; the page refreshes itself, so new runs join on their own. */
  more: ListEndProps
  /** A row's commands on its ellipsis and right-click; without them a row has no menu. */
  rowActions?: (run: RunSummary) => RunRowActions
  /** Where Export downloads the view's runs as CSV, and whether the viewer may. */
  exportAction?: { href: string; disabled: boolean }
  /** The runs dashboard for the same period and filters; without it the list has no Dashboard view. */
  dashboard?: ReactNode
}

/**
 * Every run in the workspace, newest first, or the dashboard of the same runs. A row opens the run's
 * trace and carries its commands; the period, filters, sort and view live in the URL and shape both
 * views, and new runs join as the page refreshes.
 */
export function RunList({
  read,
  workspace,
  referenceTime,
  runs,
  triggers,
  workflows,
  folders = [],
  more,
  rowActions,
  exportAction,
  dashboard,
}: RunListProps) {
  const search = useSearchParams()
  const periodId = useId()
  const { copy } = useClipboard()
  const [choosingRange, setChoosingRange] = useState(false)
  const [view, setView] = useQueryStates(runListParams, { history: 'replace', shallow: true })
  const filtered =
    view.period !== 'all' ||
    view.status !== 'all' ||
    view.trigger.length > 0 ||
    view.workflow.length > 0 ||
    view.folder.length > 0
  const showDashboard = dashboard !== undefined && view.view === 'dashboard'
  const customRange =
    view.period === 'custom' && view.start && view.end ? { start: view.start, end: view.end } : null
  const base = workspacePath(workspace.id, 'logs')
  const runPath = (id: string) => `${base}/${encodeURIComponent(id)}`
  const runHref = (id: string) => serializeRunList(platformHref(runPath(id), search), view)
  const clearFilters = () =>
    void setView({
      period: null,
      start: null,
      end: null,
      status: null,
      trigger: null,
      workflow: null,
      folder: null,
    })

  /** Legacy's row menu: the run's commands, its ID and link, where it opens, then the page's filters. */
  function rowMenu(run: RunSummary): readonly MenuAction[] {
    const own = rowActions?.(run)
    const filteredByThis = view.workflow.length === 1 && view.workflow[0] === run.workflow.id
    return [
      ...(own?.commands ?? []),
      {
        id: 'copy-id',
        label: 'Copy run ID',
        icon: 'I006',
        separatorBefore: Boolean(own?.commands.length),
        onSelect: () => void copy(run.id),
      },
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: 'link',
        onSelect: () => void copy(new URL(runPath(run.id), window.location.origin).href),
      },
      ...(own?.links ?? []),
      ...(filteredByThis
        ? []
        : [
            {
              id: 'filter-workflow',
              label: 'Filter by workflow',
              icon: 'filter' as const,
              separatorBefore: true,
              disabled: !run.workflow.id,
              onSelect: () => void setView({ workflow: [run.workflow.id] }),
            },
          ]),
      ...(filtered
        ? [
            {
              id: 'clear-filters',
              label: 'Clear filters',
              icon: 'I105' as const,
              separatorBefore: filteredByThis,
              onSelect: clearFilters,
            },
          ]
        : []),
    ]
  }

  const controls = (runs.length > 0 || filtered || showDashboard) && (
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
          <MultiSelect
            label='Trigger'
            variant='text'
            placeholder='All triggers'
            searchLabel='Search triggers'
            options={triggers}
            value={view.trigger}
            onValueChange={(trigger) => void setView({ trigger })}
          />
          <MultiSelect
            label='Workflow'
            variant='text'
            placeholder='All workflows'
            searchLabel='Search workflows'
            options={workflows}
            value={view.workflow}
            onValueChange={(workflow) => void setView({ workflow })}
          />
          {folders.length > 0 && (
            <MultiSelect
              label='Folder'
              variant='text'
              placeholder='All folders'
              searchLabel='Search folders'
              options={folders}
              value={view.folder}
              onValueChange={(folder) => void setView({ folder })}
            />
          )}
          <ChoiceMenu
            id={periodId}
            label='Period'
            options={RUN_PERIODS.map((period) => ({ value: period, label: PERIOD_LABEL[period] }))}
            value={choosingRange ? 'custom' : view.period}
            onValueChange={(period) => {
              const preset = RUN_PERIODS.find((value) => value === period && value !== 'custom')
              setChoosingRange(!preset)
              if (preset)
                void setView({ period: preset === 'all' ? null : preset, start: null, end: null })
            }}
          />
          {(choosingRange || view.period === 'custom') && (
            <DateRangePicker
              label='Custom range'
              labelHidden
              withTime
              open={choosingRange}
              onOpenChange={(open) => {
                setChoosingRange(open)
                if (!open && !customRange) document.getElementById(periodId)?.focus()
              }}
              value={customRange}
              onValueChange={(range) => {
                if (range) void setView({ period: 'custom', start: range.start, end: range.end })
              }}
            />
          )}
        </>
      }
    >
      {dashboard !== undefined && (
        <SegmentedControl
          label='Logs view'
          options={VIEW_OPTIONS}
          value={view.view}
          onSelect={(next) => void setView({ view: next === 'runs' ? null : next })}
        />
      )}
      {exportAction && (
        <Button
          variant='quiet'
          size='compact'
          icon='I049'
          disabled={exportAction.disabled}
          render={
            exportAction.disabled ? undefined : (
              <a href={exportAction.href} download>
                Export
              </a>
            )
          }
        >
          Export
        </Button>
      )}
      {!showDashboard && (
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
      )}
    </ControlBar>
  )

  return (
    <WorkspaceTabPage read={read} workspace={workspace} current='logs' controls={controls}>
      {showDashboard ? (
        dashboard
      ) : !runs.length ? (
        filtered ? (
          <WorkspaceEmpty
            title='No matching runs'
            description='Try another period, status, trigger, workflow or folder.'
            action={{ label: 'Clear filters', onClick: clearFilters }}
          />
        ) : (
          <WorkspaceEmpty
            title='No runs yet'
            description='Runs appear here when a workflow in this workspace runs.'
          />
        )
      ) : (
        <div className={styles.table}>
          <div
            className={styles.header}
            data-type='T050'
            data-actions={rowActions ? '' : undefined}
            aria-hidden='true'
          >
            <span>Workflow</span>
            <span>Status</span>
            <span data-optional=''>Trigger</span>
            <span className={styles.numeric}>Duration</span>
            <span className={styles.numeric} data-optional=''>
              Compute Units
            </span>
            <span className={styles.numeric}>Started</span>
            {rowActions && <span />}
          </div>
          <ol className={styles.rows} aria-label='Runs'>
            {runs.map((run) => (
              <li key={run.id}>
                <RunRow
                  run={run}
                  href={runHref(run.id)}
                  referenceTime={referenceTime}
                  actions={rowActions && (() => rowMenu(run))}
                />
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

interface RunRowProps {
  run: RunSummary
  href: string
  referenceTime: number
  /** Built when the menu opens, so a closed row builds none of its commands. */
  actions?: () => readonly MenuAction[]
}

/**
 * One run in Paper's RunRow lanes; the workflow name opens it across the whole row. The run last
 * stepped to in its details scrolls into view when the reader returns.
 */
function RunRow({ run, href, referenceTime, actions }: RunRowProps) {
  const label = `Actions for the ${run.workflow.name} run`
  const revealRow = useRevealRow(run.id)
  const row = (
    <div ref={revealRow} className={styles.row} data-actions={actions ? '' : undefined}>
      <span className={styles.workflow} data-type='T060'>
        <Link
          href={href}
          className={styles.open}
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
          <OverflowText text={run.workflow.name}>{run.workflow.name}</OverflowText>
        </Link>
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
      {actions && (
        <span className={styles.action}>
          <ActionMenu
            label={label}
            icon='I108'
            triggerSize='compact'
            tooltip={false}
            align='end'
            actions={actions}
          />
        </span>
      )}
    </div>
  )
  if (!actions) return row
  return (
    <ContextActionMenu label={label} actions={actions}>
      {row}
    </ContextActionMenu>
  )
}
