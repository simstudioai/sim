'use client'

import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { PropertyList } from '@sim/emcn/property-list'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  Muted,
  RowStack,
  SectionStack,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  type BackgroundWorkItem,
  type BackgroundWorkMetadata,
  useWorkspaceBackgroundWork,
} from '@/platform/lib/data/forks'
import { formatTimestamp } from '@/platform/shared/time'

/** Errors can carry a whole driver message; the status line is a glance-level summary. */
const STATUS_MAX_LENGTH = 240

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** "N verb" segments (verbs like "updated" are not pluralized), dropping zero counts. */
function countList(pairs: Array<[number | undefined, string]>): string {
  return pairs
    .filter(([n]) => (n ?? 0) > 0)
    .map(([n, verb]) => `${n} ${verb}`)
    .join(' · ')
}

/** Per-kind counts of the content a fork or sync fills in the background. */
function contentFillCounts(m: NonNullable<BackgroundWorkMetadata>): string[] {
  const kinds: Array<[number | undefined, string]> = [
    [m.knowledgeBases, 'knowledge base'],
    [m.documents, 'document'],
    [m.tables, 'table'],
    [m.files, 'file'],
    [m.skills, 'skill'],
  ]
  return kinds.flatMap(([n, noun]) => (n && n > 0 ? [plural(n, noun)] : []))
}

/** A failed fill keeps the counts it planned, so they must not read as copied. */
function contentFillLabel(status: BackgroundWorkItem['status']): string {
  switch (status) {
    case 'pending':
    case 'processing':
      return 'Copying'
    case 'failed':
      return 'Copy failed'
    default:
      return 'Copied'
  }
}

interface JobReport {
  groups: Array<{ label: string; names: string[] }>
  notes: Array<{ value: string; warning?: boolean }>
}

/** The workspace whose activity is shown, for phrasing rows recorded on the other side of an edge. */
interface ActivityView {
  workspaceId: string
  workspaceNames: ReadonlyMap<string, string>
}

function partnerName(job: BackgroundWorkItem, view: ActivityView): string {
  return view.workspaceNames.get(job.workspaceId) ?? 'another workspace'
}

/**
 * Each event is recorded once, on the workspace it started from, so a row recorded on an edge
 * partner reads from THIS workspace's side (the parent's "Pushed to X" reads "Received push from"
 * here).
 */
function jobTitle(job: BackgroundWorkItem, view: ActivityView): string {
  const m = job.metadata
  const recordedHere = job.workspaceId === view.workspaceId
  switch (job.kind) {
    case 'fork_content_copy':
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

/** Bad outcomes keep their status intent; successful rows are told apart by operation. */
function jobIntent(job: BackgroundWorkItem) {
  if (job.status === 'failed') return 'danger' as const
  if (job.status === 'completed_with_warnings') return 'warning' as const
  if (job.status !== 'completed') return 'neutral' as const
  switch (job.kind) {
    case 'fork_content_copy':
      return 'info' as const
    case 'fork_sync':
      return job.metadata?.direction === 'pull' ? ('info' as const) : ('success' as const)
    default:
      return 'neutral' as const
  }
}

/** The state a reader cannot act on from the tag alone; a successful row needs none. */
function jobStatusNote(job: BackgroundWorkItem): string | null {
  switch (job.status) {
    case 'pending':
      return 'Queued'
    case 'processing':
      return 'In progress'
    case 'failed':
      return truncate(job.error ?? 'Failed', STATUS_MAX_LENGTH)
    case 'completed_with_warnings':
      return truncate(job.message ?? 'Completed with warnings', STATUS_MAX_LENGTH)
    default:
      return null
  }
}

function jobReport(job: BackgroundWorkItem): JobReport {
  const m = job.metadata
  const groups: JobReport['groups'] = []
  const notes: JobReport['notes'] = []
  if (!m) return { groups, notes }

  const addGroup = (label: string, names: string[] | undefined) => {
    if (names && names.length > 0) groups.push({ label, names })
  }
  const addContentFillWarnings = () => {
    if (m.failed && m.failed > 0) {
      notes.push({ value: `${plural(m.failed, 'resource')} failed to copy`, warning: true })
    }
    if (m.clearingFailed) notes.push({ value: 'Reference cleanup incomplete', warning: true })
  }

  if (job.kind === 'fork_sync') {
    addGroup('Updated', m.updatedNames)
    addGroup('Created', m.createdNames)
    addGroup('Archived', m.archivedNames)
    addGroup(contentFillLabel(job.status), contentFillCounts(m))
    if (groups.length === 0) {
      const counts = countList([
        [m.updated, 'updated'],
        [m.created, 'created'],
        [m.archived, 'archived'],
      ])
      if (counts) notes.push({ value: counts })
    }
    for (const item of m.needsConfiguration ?? []) {
      notes.push({
        value: `${item.workflowName} — re-check ${item.blocks.join(', ')}`,
        warning: true,
      })
    }
    for (const item of m.clearedOptional ?? []) {
      notes.push({ value: `${item.workflowName} — optional cleared in ${item.blocks.join(', ')}` })
    }
    if (m.deployFailed && m.deployFailed > 0) {
      notes.push({ value: `${plural(m.deployFailed, 'workflow')} failed to deploy`, warning: true })
    }
    for (const warning of m.deployWarnings ?? []) notes.push({ value: warning, warning: true })
    addContentFillWarnings()
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

  addGroup('Workflows', m.workflowNames)
  addGroup('Knowledge bases', m.knowledgeBaseNames)
  addGroup('Tables', m.tableNames)
  addGroup('Files', m.fileNames)
  addGroup('Custom tools', m.customToolNames)
  addGroup('Skills', m.skillNames)
  addGroup('MCP servers', m.mcpServerNames)
  addGroup('Workflow MCP servers', m.workflowMcpServerNames)
  // Sync fills recorded before they joined the sync's own row carry counts only.
  if (groups.length === 0) {
    const counts = [
      ...(m.workflowsCopied ? [plural(m.workflowsCopied, 'workflow')] : []),
      ...contentFillCounts(m),
    ].join(' · ')
    if (counts) notes.push({ value: counts })
  }
  addContentFillWarnings()
  return { groups, notes }
}

function ActivityEntry({ job, view }: { job: BackgroundWorkItem; view: ActivityView }) {
  const report = jobReport(job)
  const status = jobStatusNote(job)
  const actor = job.metadata?.actorName || 'System'
  const introduction = (
    <ActionRow>
      <StatusTag label={jobEventLabel(job)} intent={jobIntent(job)} live={status !== null} />
      <Muted>
        {[actor, formatTimestamp(new Date(job.startedAt).getTime()), status]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
    </ActionRow>
  )
  const hasDetails = report.groups.length > 0 || report.notes.length > 0 || Boolean(job.error)
  return (
    <Disclosure variant='activity' label={jobTitle(job, view)} introduction={introduction}>
      {hasDetails ? (
        <RowStack>
          {report.groups.length > 0 && (
            <PropertyList
              title='Details'
              titleHidden
              properties={report.groups.map((group) => ({
                id: group.label,
                label: group.label,
                kind: 'text' as const,
                value: group.names.join(', '),
              }))}
            />
          )}
          {report.notes.map((note, index) =>
            note.warning ? (
              <InlineNotice key={`${index}:${note.value}`} intent='warning' message={note.value} />
            ) : (
              <Muted key={`${index}:${note.value}`}>{note.value}</Muted>
            )
          )}
          {job.error && <InlineNotice intent='danger' message={job.error} />}
        </RowStack>
      ) : null}
    </Disclosure>
  )
}

interface ForkActivityProps {
  workspaceId: string
  /** Lineage partner names by id, for rows recorded on the other side of an edge. */
  workspaceNames: ReadonlyMap<string, string>
  onBack: () => void
  /** The last sync into this workspace, while it can still be undone. */
  undoable: { otherName: string } | null
  rollingBack: boolean
  onRollback: () => void
}

/**
 * Every fork, sync and rollback involving this workspace, on both sides of each edge, newest
 * first and paged; each row opens to what changed. Rollback sits in the header while the last sync
 * into this workspace can be undone.
 */
export function ForkActivity({
  workspaceId,
  workspaceNames,
  onBack,
  undoable,
  rollingBack,
  onRollback,
}: ForkActivityProps) {
  const feed = useWorkspaceBackgroundWork(workspaceId)
  const view: ActivityView = { workspaceId, workspaceNames }
  const jobs = feed.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <SectionStack>
      <DetailHeader backLabel='Workspace forks' onBack={onBack} title='Activity'>
        {undoable && (
          <Button
            variant='quiet'
            destructive
            size='compact'
            disabled={rollingBack}
            onClick={onRollback}
          >
            Rollback
          </Button>
        )}
      </DetailHeader>
      {undoable && (
        <InlineNotice
          message={`The last sync into this workspace (from ${undoable.otherName}) can be undone — it restores each workflow's prior deployed version.`}
        />
      )}
      <SettingsSection title='Events'>
        {jobs.length > 0 ? (
          <FieldStack>
            <RowStack>
              {jobs.map((job) => (
                <ActivityEntry key={job.id} job={job} view={view} />
              ))}
            </RowStack>
            <LoadMoreFooter
              state={{
                hasMore: feed.hasNextPage,
                loading: feed.isFetchingNextPage,
                error: feed.isFetchNextPageError
                  ? getErrorMessage(feed.error, "Couldn't load more activity")
                  : undefined,
                onLoadMore: () => void feed.fetchNextPage(),
              }}
            />
          </FieldStack>
        ) : feed.isPending ? null : feed.isError ? (
          <FieldStack>
            <FailureNotice
              message="Couldn't load activity. Try again shortly."
              retrying={feed.isFetching}
              onRetry={() => void feed.refetch()}
            />
          </FieldStack>
        ) : (
          <EmptyState
            title='Nothing here yet'
            description='Forks, syncs, and rollbacks will appear here.'
          />
        )}
      </SettingsSection>
    </SectionStack>
  )
}
