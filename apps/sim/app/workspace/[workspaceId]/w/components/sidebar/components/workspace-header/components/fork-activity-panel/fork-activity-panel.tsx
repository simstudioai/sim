'use client'

import { Fragment, useState } from 'react'
import { formatDateTime } from '@sim/utils/formatting'
import { Badge, ChevronDown, Loader } from '@/components/emcn'
import type {
  BackgroundWorkItem,
  ForkOperationReport,
  ForkReportGroup,
} from '@/lib/api/contracts/workspace-fork'
import { cn } from '@/lib/core/utils/cn'
import { useWorkspaceBackgroundWork } from '@/hooks/queries/background-work'

const HEADER_TEXT = 'font-medium text-[var(--text-tertiary)] text-caption'
const ROW_TEXT = 'font-medium text-[var(--text-primary)] text-caption'

const STATUS_BADGE: Record<
  ForkOperationReport['status'],
  { variant: 'green' | 'amber' | 'red'; label: string }
> = {
  succeeded: { variant: 'green', label: 'Succeeded' },
  succeeded_with_warnings: { variant: 'amber', label: 'Warnings' },
  failed: { variant: 'red', label: 'Failed' },
}

const SEVERITY_DOT: Record<ForkReportGroup['severity'], string> = {
  info: 'bg-[var(--text-muted)]',
  warning: 'bg-[var(--badge-amber-text)]',
  error: 'bg-[var(--text-error)]',
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Join "N verb" segments (verbs like "updated" aren't pluralized), dropping zero counts. */
function countList(pairs: Array<[number | undefined, string]>): string {
  return pairs
    .filter(([n]) => (n ?? 0) > 0)
    .map(([n, verb]) => `${n} ${verb}`)
    .join(' · ')
}

/** The audit-row title, derived per kind from the job's metadata. */
function jobTitle(job: BackgroundWorkItem): string {
  const m = job.metadata
  switch (job.kind) {
    case 'fork_content_copy':
      return m?.childWorkspaceName ? `Forked to "${m.childWorkspaceName}"` : (job.message ?? 'Fork')
    case 'fork_sync':
      if (!m?.otherWorkspaceName) return job.message ?? 'Sync'
      return m.direction === 'pull'
        ? `Pulled from "${m.otherWorkspaceName}"`
        : `Synced to "${m.otherWorkspaceName}"`
    case 'fork_rollback':
      return m?.otherWorkspaceName
        ? `Undid sync from "${m.otherWorkspaceName}"`
        : (job.message ?? 'Rollback')
    default:
      return job.message ?? 'Activity'
  }
}

/** The expand-row detail lines for a job, built per kind from its metadata. */
function jobDetailLines(job: BackgroundWorkItem): string[] {
  const m = job.metadata
  if (!m) return []

  if (job.kind === 'fork_sync') {
    const lines: string[] = []
    const counts = countList([
      [m.updated, 'updated'],
      [m.created, 'created'],
      [m.archived, 'archived'],
      [m.redeployed, 'redeployed'],
    ])
    if (counts) lines.push(counts)
    if (m.deployFailed && m.deployFailed > 0) lines.push(`${m.deployFailed} failed to deploy`)
    return lines
  }

  if (job.kind === 'fork_rollback') {
    const counts = countList([
      [m.restored, 'restored'],
      [m.unarchived, 'unarchived'],
      [m.removed, 'removed'],
      [m.skipped, 'skipped'],
    ])
    return counts ? [counts] : []
  }

  // fork_content_copy: countable resource breakdown + the copy outcome.
  const lines: string[] = []
  const kinds: Array<[number | undefined, string]> = [
    [m.workflowsCopied, 'workflow'],
    [m.tables, 'table'],
    [m.knowledgeBases, 'knowledge base'],
    [m.files, 'file'],
  ]
  const selected = kinds.filter(([n]) => (n ?? 0) > 0).map(([n, noun]) => plural(n as number, noun))
  if (selected.length > 0) lines.push(selected.join(' · '))
  if (m.copied != null) {
    lines.push(
      m.failed && m.failed > 0
        ? `${plural(m.copied, 'item')} copied, ${m.failed} failed`
        : `${plural(m.copied, 'item')} copied`
    )
  }
  return lines
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

/** One audit-log row: status + "Forked to ...", expanding to what was copied. */
function ForkJobRow({ job }: { job: BackgroundWorkItem }) {
  const [expanded, setExpanded] = useState(false)
  const detailLines = jobDetailLines(job)
  const hasDetail = detailLines.length > 0 || Boolean(job.error)
  const title = jobTitle(job)

  return (
    <Fragment>
      <div
        role='button'
        tabIndex={hasDetail ? 0 : -1}
        className={cn(
          'flex h-[36px] items-center px-4 transition-colors duration-100',
          hasDetail
            ? 'cursor-pointer hover-hover:bg-[var(--surface-6)] dark:hover-hover:bg-[var(--border)]'
            : 'cursor-default'
        )}
        onClick={() => hasDetail && setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (!hasDetail || event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setExpanded((value) => !value)
          }
        }}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <JobStatusIndicator status={job.status} />
          <span className={cn('min-w-0 truncate', ROW_TEXT)}>{title}</span>
        </div>
        <span className={cn('w-[150px] shrink-0 truncate text-[var(--text-tertiary)]', ROW_TEXT)}>
          {formatDateTime(new Date(job.startedAt))}
        </span>
        {hasDetail ? (
          <ChevronDown
            className={cn(
              'h-[6px] w-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        ) : (
          <span className='w-[14px] shrink-0' />
        )}
      </div>
      {expanded && hasDetail ? (
        <div className='flex flex-col gap-0.5 px-4 pb-2.5 pl-[42px]'>
          {detailLines.map((line) => (
            <span key={line} className='text-[var(--text-tertiary)] text-caption'>
              {line}
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
        <span className={cn('w-[150px] shrink-0', HEADER_TEXT)}>When</span>
        <span className='w-[14px] shrink-0' />
      </div>
      <div className='bg-[var(--surface-2)]'>
        {jobs.map((job) => (
          <ForkJobRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  )
}

/** One collapsed report group: severity dot + label + count, expanding to its items. */
function ReportGroupRow({ group }: { group: ForkReportGroup }) {
  const [expanded, setExpanded] = useState(false)
  const hasItems = group.items.length > 0
  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        className={cn(
          'flex w-full items-center gap-2 text-left text-[var(--text-body)] text-sm',
          hasItems ? 'hover:text-[var(--text-primary)]' : 'cursor-default'
        )}
        onClick={() => hasItems && setExpanded((value) => !value)}
        disabled={!hasItems}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', SEVERITY_DOT[group.severity])} />
        <span className='min-w-0 flex-1 truncate'>{group.label}</span>
        <span className='shrink-0 text-[var(--text-muted)] text-small'>{group.count}</span>
        {hasItems ? (
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        ) : (
          <span className='w-[10px] shrink-0' />
        )}
      </button>
      {expanded && hasItems ? (
        <div className='ml-[18px] flex max-h-44 flex-col gap-1 overflow-y-auto'>
          {group.items.map((item, index) => (
            <div key={`${item.label}:${index}`} className='flex min-w-0 flex-col'>
              <span className='truncate text-[var(--text-body)] text-sm'>{item.label}</span>
              {item.detail ? (
                <span className='text-[var(--text-muted)] text-xs'>{item.detail}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ForkActivityPanelProps {
  /** The most recent in-session operation report (sync / rollback), if any. */
  report: ForkOperationReport | null
  /** The triggering operation is currently running (mutation in flight). */
  pending?: boolean
  pendingLabel?: string
  /** Poll the durable fork-job audit trail for this workspace. */
  backgroundWorkspaceId?: string
}

/**
 * The "Activity" tab for the Sync / Fork modals: a durable audit log of fork jobs
 * (a deployment-versions-style table - status, "Forked to ...", timestamp, expand for
 * what was copied) plus the in-session report of the last synchronous operation.
 */
export function ForkActivityPanel({
  report,
  pending = false,
  pendingLabel = 'Working…',
  backgroundWorkspaceId,
}: ForkActivityPanelProps) {
  const { data: jobs = [] } = useWorkspaceBackgroundWork(backgroundWorkspaceId)

  const hasAnything = pending || jobs.length > 0 || Boolean(report)
  if (!hasAnything) {
    return (
      <div className='px-2 py-8 text-center text-[var(--text-muted)] text-small'>
        Nothing here yet. Results from your last action will appear here.
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

      {report ? (
        <div className='flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>
              {report.headline}
            </span>
            <Badge variant={STATUS_BADGE[report.status].variant} size='sm' dot>
              {STATUS_BADGE[report.status].label}
            </Badge>
          </div>
          {report.groups.length > 0 ? (
            <div className='flex flex-col gap-2'>
              {report.groups.map((group) => (
                <ReportGroupRow key={group.id} group={group} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
