'use client'

import { useCallback, useMemo } from 'react'
import { Badge, Button } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import type { BackgroundWorkItem } from '@/lib/api/contracts/workspace-fork'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useWorkspaceBackgroundWork } from '@/hooks/queries/background-work'

const logger = createLogger('ForkActivityPanel')

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** Join "N verb" segments (verbs like "updated" aren't pluralized), dropping zero counts. */
function countList(pairs: Array<[number | undefined, string]>): string {
  return pairs
    .filter(([n]) => (n ?? 0) > 0)
    .map(([n, verb]) => `${n} ${verb}`)
    .join(' · ')
}

/** A named group (one resource kind or change action) of a job's report. */
interface ReportGroup {
  label: string
  names: string[]
}

/** A job's expanded report: named groups plus plain notes (counts / warnings). */
interface JobReport {
  groups: ReportGroup[]
  notes: Array<{ value: string; warning?: boolean }>
}

/** The workspace whose activity is being viewed, for phrasing rows recorded on either side of an edge. */
interface ActivityView {
  workspaceId: string
  /** Lineage partner names by id (the parent + this workspace's forks). */
  workspaceNames: ReadonlyMap<string, string>
}

/** Display name of the workspace a partner-recorded row was keyed to (the edge's other side). */
function partnerName(job: BackgroundWorkItem, view: ActivityView): string {
  return view.workspaceNames.get(job.workspaceId) ?? 'another workspace'
}

/**
 * The activity-row title, derived per kind from the job's metadata. Every event is
 * recorded once, keyed to the workspace it was initiated from, so a row keyed to an
 * edge partner is phrased from THIS workspace's side (e.g. the parent's "Pushed to X"
 * row reads "Received push from <fork>" when X views it).
 */
function jobTitle(job: BackgroundWorkItem, view: ActivityView): string {
  const m = job.metadata
  const recordedHere = job.workspaceId === view.workspaceId
  switch (job.kind) {
    case 'fork_content_copy':
      // A partner-recorded copy row is either this workspace's own creation (recorded
      // on the parent, carrying our id as the child) or a sync's resource fill.
      if (!recordedHere && m?.childWorkspaceId === view.workspaceId) {
        return `Forked from "${partnerName(job, view)}"`
      }
      return m?.childWorkspaceName
        ? `Forked into "${m.childWorkspaceName}"`
        : (job.message ?? 'Fork')
    case 'fork_sync':
      if (!recordedHere) {
        return m?.direction === 'pull'
          ? `Pulled by "${partnerName(job, view)}"`
          : `Received push from "${partnerName(job, view)}"`
      }
      if (!m?.otherWorkspaceName) return job.message ?? 'Sync'
      return m.direction === 'pull'
        ? `Pulled from "${m.otherWorkspaceName}"`
        : `Pushed to "${m.otherWorkspaceName}"`
    case 'fork_rollback':
      if (!recordedHere) return `Sync undone in "${partnerName(job, view)}"`
      return m?.otherWorkspaceName
        ? `Undid sync from "${m.otherWorkspaceName}"`
        : (job.message ?? 'Rollback')
    default:
      return job.message ?? 'Activity'
  }
}

/** Short action label for the Event badge, per job kind. */
function jobEventLabel(job: BackgroundWorkItem): string {
  switch (job.kind) {
    case 'fork_content_copy':
      return 'Fork'
    case 'fork_sync':
      return job.metadata?.direction === 'pull' ? 'Pull' : 'Push'
    case 'fork_rollback':
      return 'Rollback'
    default:
      return 'Activity'
  }
}

/**
 * Badge variant: bad outcomes keep the status colors (red/amber), while successful
 * rows are colored by operation so Fork / Push / Pull / Rollback are distinguishable
 * at a glance.
 */
function jobBadgeVariant(job: BackgroundWorkItem) {
  if (job.status === 'failed') return 'red' as const
  if (job.status === 'completed_with_warnings') return 'amber' as const
  if (job.status !== 'completed') return 'gray-secondary' as const
  switch (job.kind) {
    case 'fork_content_copy':
      return 'blue' as const
    case 'fork_sync':
      return job.metadata?.direction === 'pull' ? ('cyan' as const) : ('green' as const)
    case 'fork_rollback':
      return 'purple' as const
    default:
      return 'gray-secondary' as const
  }
}

/** Build a job's report (named groups + plain notes) from its metadata. */
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
  addGroup('MCP servers', m.mcpServerNames)
  addGroup('Workflow MCP servers', m.workflowMcpServerNames)
  // Sync content-copy rows record per-kind COUNTS only (fork rows carry names), so fall back
  // to the counts when no named group rendered.
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
  if (m.clearingFailed) {
    notes.push({ value: 'Reference cleanup incomplete', warning: true })
  }
  return { groups, notes }
}

/** The expanded detail box content for one job: named groups, notes, and any error. */
function jobDetails(job: BackgroundWorkItem, report: JobReport) {
  return (
    <>
      {report.groups.map((group) => (
        <div key={group.label} className='flex gap-2'>
          <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>{group.label}</span>
          <span className='min-w-0 flex-1 text-[var(--text-primary)]'>
            {group.names.join(', ')}
          </span>
        </div>
      ))}
      {report.notes.map((note, index) => (
        <span
          key={`${index}:${note.value}`}
          className={note.warning ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]'}
        >
          {note.value}
        </span>
      ))}
      {job.error ? <span className='text-[var(--text-error)]'>{job.error}</span> : null}
    </>
  )
}

/** Maps a background job to the shared {@link ActivityLog} row shape. */
function toActivityEntry(job: BackgroundWorkItem, view: ActivityView): ActivityLogEntry {
  const report = jobReport(job)
  const hasDetails = report.groups.length > 0 || report.notes.length > 0 || Boolean(job.error)
  return {
    id: job.id,
    timestamp: formatDateTime(new Date(job.startedAt)),
    event: (
      <Badge variant={jobBadgeVariant(job)} size='sm' className='shrink-0'>
        {jobEventLabel(job)}
      </Badge>
    ),
    description: jobTitle(job, view),
    actor: job.metadata?.actorName || 'System',
    details: hasDetails ? jobDetails(job, report) : undefined,
  }
}

interface ForkActivityPanelProps {
  /** Poll the durable fork-job audit trail involving this workspace. */
  workspaceId: string
  /** Lineage partner names by id (the parent + forks), for phrasing partner-recorded rows. */
  workspaceNames: ReadonlyMap<string, string>
}

/**
 * A durable audit log of every fork, sync, and rollback involving the workspace
 * (both sides of each fork edge), rendered through the shared {@link ActivityLog}
 * so it reads identically to the enterprise audit log: each row (timestamp, action
 * badge, description, actor) expands to a per-kind breakdown of what changed.
 */
export function ForkActivityPanel({ workspaceId, workspaceNames }: ForkActivityPanelProps) {
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useWorkspaceBackgroundWork(workspaceId)
  const view: ActivityView = { workspaceId, workspaceNames }

  const jobs = useMemo(() => {
    if (!data?.pages) return []
    return data.pages.flatMap((page) => page.items)
  }, [data])

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage().catch((error: unknown) => {
        logger.error('Failed to load more fork activity', { error })
      })
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <ActivityLog
      entries={jobs.map((job) => toActivityEntry(job, view))}
      eventColumn='compact'
      // A failed or still-loading feed must never claim "nothing here yet".
      emptyState={
        isError ? (
          <SettingsEmptyState variant='inline'>
            Couldn't load activity. Try again shortly.
          </SettingsEmptyState>
        ) : isPending ? undefined : (
          <SettingsEmptyState variant='inline'>
            Nothing here yet. Forks, syncs, and rollbacks will appear here.
          </SettingsEmptyState>
        )
      }
      footer={
        hasNextPage ? (
          <div className='flex justify-center py-4'>
            <Button variant='ghost' onClick={handleLoadMore} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}
