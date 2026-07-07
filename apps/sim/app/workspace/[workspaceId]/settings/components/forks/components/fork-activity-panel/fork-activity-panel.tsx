'use client'

import { Badge } from '@sim/emcn'
import { formatDateTime } from '@sim/utils/formatting'
import type { BackgroundWorkItem } from '@/lib/api/contracts/workspace-fork'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { useWorkspaceBackgroundWork } from '@/hooks/queries/background-work'

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

/** The activity-row title, derived per kind from the job's metadata. */
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

/** Badge variant for a job's terminal (or in-flight) status. */
function jobBadgeVariant(status: BackgroundWorkItem['status']) {
  switch (status) {
    case 'completed':
      return 'green' as const
    case 'failed':
      return 'red' as const
    case 'completed_with_warnings':
      return 'amber' as const
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
function toActivityEntry(job: BackgroundWorkItem): ActivityLogEntry {
  const report = jobReport(job)
  const hasDetails = report.groups.length > 0 || report.notes.length > 0 || Boolean(job.error)
  return {
    id: job.id,
    timestamp: formatDateTime(new Date(job.startedAt)),
    event: (
      <Badge variant={jobBadgeVariant(job.status)} size='sm' className='shrink-0'>
        {jobEventLabel(job)}
      </Badge>
    ),
    description: jobTitle(job),
    actor: job.metadata?.actorName || 'System',
    details: hasDetails ? jobDetails(job, report) : undefined,
  }
}

interface ForkActivityPanelProps {
  /** Poll the durable fork-job audit trail for this workspace. */
  backgroundWorkspaceId?: string
  /** Narrows the log to related jobs (e.g. a single fork's detail sub-view). */
  filterJob?: (job: BackgroundWorkItem) => boolean
  /** Empty-state copy override; the default speaks to the whole workspace log. */
  emptyMessage?: string
}

/**
 * A durable audit log of every fork, sync, and rollback, rendered through the
 * shared {@link ActivityLog} so it reads identically to the enterprise audit log:
 * each row (timestamp, action badge, description, actor) expands to a per-kind
 * breakdown of what changed.
 */
export function ForkActivityPanel({
  backgroundWorkspaceId,
  filterJob,
  emptyMessage = 'Nothing here yet. Forks, syncs, and rollbacks will appear here.',
}: ForkActivityPanelProps) {
  const { data: allJobs = [] } = useWorkspaceBackgroundWork(backgroundWorkspaceId)
  const jobs = filterJob ? allJobs.filter(filterJob) : allJobs

  return (
    <ActivityLog
      entries={jobs.map(toActivityEntry)}
      emptyState={<SettingsEmptyState variant='inline'>{emptyMessage}</SettingsEmptyState>}
    />
  )
}
