'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, cn, Loader } from '@sim/emcn'
import { formatDateTime } from '@sim/utils/formatting'
import type { BackgroundWorkItem } from '@/lib/api/contracts/workspace-fork'
import { useWorkspaceBackgroundWork } from '@/hooks/queries/background-work'

const HEADER_TEXT = 'font-medium text-[var(--text-tertiary)] text-caption'
const ROW_TEXT = 'font-medium text-[var(--text-primary)] text-caption'

/** Fixed column widths shared by the header and rows so they stay aligned. */
const COL = {
  BY: 'w-[132px]',
  CHEVRON: 'w-[14px]',
} as const

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Join "N verb" segments (verbs like "updated" aren't pluralized), dropping zero counts. */
function countList(pairs: Array<[number | undefined, string]>): string {
  return pairs
    .filter(([n]) => (n ?? 0) > 0)
    .map(([n, verb]) => `${n} ${verb}`)
    .join(' · ')
}

/** A named, collapsible group (one resource kind or change action) of a job's report. */
interface ReportGroup {
  label: string
  names: string[]
}

/** A job's expanded report: collapsible named groups plus plain notes (counts / warnings). */
interface JobReport {
  groups: ReportGroup[]
  notes: Array<{ value: string; warning?: boolean }>
}

/** The audit-row title, derived per kind from the job's metadata. */
function jobTitle(job: BackgroundWorkItem): string {
  const m = job.metadata
  switch (job.kind) {
    case 'fork_content_copy':
      return m?.childWorkspaceName
        ? `Forked into "${m.childWorkspaceName}"`
        : (job.message ?? 'Fork')
    case 'fork_sync':
      if (!m?.otherWorkspaceName) return job.message ?? 'Sync'
      return m.direction === 'pull'
        ? `Pulled from "${m.otherWorkspaceName}"`
        : `Pushed to "${m.otherWorkspaceName}"`
    case 'fork_rollback':
      return m?.otherWorkspaceName
        ? `Undid sync from "${m.otherWorkspaceName}"`
        : (job.message ?? 'Rollback')
    default:
      return job.message ?? 'Activity'
  }
}

/** Build a job's report (collapsible named groups + plain notes) from its metadata. */
function jobReport(job: BackgroundWorkItem): JobReport {
  const m = job.metadata
  const groups: ReportGroup[] = []
  const notes: JobReport['notes'] = []
  if (!m) return { groups, notes }

  const addGroup = (label: string, names: string[] | undefined) => {
    if (names && names.length > 0) groups.push({ label, names })
  }

  if (job.kind === 'fork_sync') {
    addGroup('Updated', m.updatedNames)
    addGroup('Created', m.createdNames)
    addGroup('Archived', m.archivedNames)
    // Pre-names entries fall back to the count summary (redeployed mirrors updated).
    if (groups.length === 0) {
      const counts = countList([
        [m.updated, 'updated'],
        [m.created, 'created'],
        [m.archived, 'archived'],
      ])
      if (counts) notes.push({ value: counts })
    }
    if (m.needsConfiguration && m.needsConfiguration.length > 0) {
      for (const item of m.needsConfiguration) {
        notes.push({
          value: `${item.workflowName} — re-check ${item.blocks.join(', ')}`,
          warning: true,
        })
      }
    }
    if (m.clearedOptional && m.clearedOptional.length > 0) {
      for (const item of m.clearedOptional) {
        notes.push({
          value: `${item.workflowName} — optional cleared in ${item.blocks.join(', ')}`,
        })
      }
    }
    if (m.deployFailed && m.deployFailed > 0) {
      notes.push({ value: `${plural(m.deployFailed, 'workflow')} failed to deploy`, warning: true })
    }
    return { groups, notes }
  }

  if (job.kind === 'fork_rollback') {
    const counts = countList([
      [m.restored, 'restored'],
      [m.unarchived, 'unarchived'],
      [m.removed, 'removed'],
      [m.skipped, 'skipped'],
    ])
    if (counts) notes.push({ value: counts })
    return { groups, notes }
  }

  // fork_content_copy: a named breakdown of everything copied, by kind.
  addGroup('Workflows', m.workflowNames)
  addGroup('Knowledge bases', m.knowledgeBaseNames)
  addGroup('Tables', m.tableNames)
  addGroup('Files', m.fileNames)
  addGroup('Custom tools', m.customToolNames)
  addGroup('Skills', m.skillNames)
  addGroup('Workflow MCP servers', m.workflowMcpServerNames)
  // Pre-names entries fall back to the per-kind counts.
  if (groups.length === 0) {
    const counts = [
      [m.workflowsCopied, 'workflow'],
      [m.knowledgeBases, 'knowledge base'],
      [m.tables, 'table'],
      [m.files, 'file'],
    ]
      .filter(([n]) => ((n as number | undefined) ?? 0) > 0)
      .map(([n, noun]) => plural(n as number, noun as string))
      .join(' · ')
    if (counts) notes.push({ value: counts })
  }
  if (m.failed && m.failed > 0) {
    notes.push({ value: `${plural(m.failed, 'resource')} failed to copy`, warning: true })
  }
  return { groups, notes }
}

/** Status indicator: the platform loader while active, a colored dot once terminal. */
function JobStatusIndicator({ status }: { status: BackgroundWorkItem['status'] }) {
  if (status === 'pending' || status === 'processing') {
    return <Loader animate className='size-[12px] shrink-0 text-[var(--text-tertiary)]' />
  }
  const color =
    status === 'failed'
      ? 'bg-[var(--text-error)]'
      : status === 'completed_with_warnings'
        ? 'bg-[var(--badge-amber-text)]'
        : 'bg-[var(--indicator-active)]'
  const label =
    status === 'failed'
      ? 'Failed'
      : status === 'completed_with_warnings'
        ? 'Completed with warnings'
        : 'Done'
  return <span className={cn('size-[6px] shrink-0 rounded-full', color)} title={label} />
}

/** A collapsed report group ("Label  N  ⌄") that expands to its scrollable name list. */
function ReportGroupRow({ group }: { group: ReportGroup }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center gap-2 text-left text-[var(--text-secondary)] text-caption transition-colors hover:text-[var(--text-primary)]'
      >
        <span className='min-w-0 flex-1 truncate'>{group.label}</span>
        <span className='shrink-0 text-[var(--text-muted)]'>{group.names.length}</span>
        <ChevronDown
          className={cn(
            'h-[6px] w-[10px] shrink-0 text-[var(--text-icon)] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <div className='max-h-44 overflow-y-auto pb-1'>
          {group.names.map((name) => (
            <div
              key={name}
              className='truncate text-[var(--text-tertiary)] text-caption leading-6'
              title={name}
            >
              {name}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** One audit-log row: status + title + actor; expands to the timestamp + report. */
function ForkJobRow({ job }: { job: BackgroundWorkItem }) {
  const [expanded, setExpanded] = useState(false)
  const report = jobReport(job)
  const title = jobTitle(job)

  return (
    <Fragment>
      <div
        role='button'
        tabIndex={0}
        className='flex h-[36px] cursor-pointer items-center px-4 transition-colors duration-100 hover-hover:bg-[var(--surface-6)] dark:hover-hover:bg-[var(--border)]'
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded((value) => !value)
          }
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <JobStatusIndicator status={job.status} />
          <span className={cn('min-w-0 truncate', ROW_TEXT)} title={title}>
            {title}
          </span>
        </div>
        <span
          className={cn(COL.BY, 'shrink-0 truncate text-[var(--text-tertiary)]', ROW_TEXT)}
          title={job.metadata?.actorName ?? undefined}
        >
          {job.metadata?.actorName || '—'}
        </span>
        <ChevronDown
          className={cn(
            'h-[6px] shrink-0 text-[var(--text-icon)] transition-transform',
            COL.CHEVRON,
            expanded && 'rotate-180'
          )}
        />
      </div>
      {expanded ? (
        <div className='flex flex-col gap-1.5 px-4 pb-3 pl-[42px]'>
          <span className='text-[var(--text-muted)] text-caption'>
            {formatDateTime(new Date(job.startedAt))}
          </span>
          {report.groups.map((group) => (
            <ReportGroupRow key={group.label} group={group} />
          ))}
          {report.notes.map((note, index) => (
            <span
              key={`${index}:${note.value}`}
              className={cn(
                'text-caption',
                note.warning ? 'text-[var(--text-error)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              {note.value}
            </span>
          ))}
          {job.error ? (
            <span className='text-[var(--text-error)] text-caption'>{job.error}</span>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  )
}

/** Audit-log table of fork jobs, mirroring the deployment-versions table chrome. */
function ForkJobsTable({ jobs }: { jobs: BackgroundWorkItem[] }) {
  return (
    <div className='overflow-hidden rounded-sm border border-[var(--border)]'>
      <div className='flex h-[30px] items-center bg-[var(--surface-1)] px-4'>
        <span className={cn('flex-1', HEADER_TEXT)}>Activity</span>
        <span className={cn(COL.BY, 'shrink-0', HEADER_TEXT)}>By</span>
        <span className={cn(COL.CHEVRON, 'shrink-0')} />
      </div>
      <div className='bg-[var(--surface-2)]'>
        {jobs.map((job) => (
          <ForkJobRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}

interface ForkActivityPanelProps {
  /** The triggering operation is currently running (mutation in flight). */
  pending?: boolean
  pendingLabel?: string
  /** Poll the durable fork-job audit trail for this workspace. */
  backgroundWorkspaceId?: string
}

/**
 * The "Activity" tab for Manage Forks: a durable audit log of every fork, sync, and
 * rollback as its own row (status, title, actor), each expanding to the timestamp and a
 * collapsible per-kind breakdown of what changed. A loader shows while the current
 * action runs.
 */
export function ForkActivityPanel({
  pending = false,
  pendingLabel = 'Working…',
  backgroundWorkspaceId,
}: ForkActivityPanelProps) {
  const { data: jobs = [] } = useWorkspaceBackgroundWork(backgroundWorkspaceId)

  if (!pending && jobs.length === 0) {
    return (
      <div className='px-2 py-8 text-center text-[var(--text-muted)] text-small'>
        Nothing here yet. Forks, syncs, and rollbacks will appear here.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-5 px-2'>
      {pending ? (
        <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
          <Loader animate className='size-[14px] shrink-0 text-[var(--text-tertiary)]' />
          <span>{pendingLabel}</span>
        </div>
      ) : null}

      {jobs.length > 0 ? <ForkJobsTable jobs={jobs} /> : null}
    </div>
  )
}
