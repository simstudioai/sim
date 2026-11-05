import type { AuditLogPage } from '@/lib/api/contracts/audit-logs'
import type { TimeRange } from '@/stores/logs/filters/types'

/** One entry of the audit feed, as its contract delivers it. */
type AuditLogEntry = AuditLogPage['data'][number]

interface WorkspaceLookup<Workspace> {
  data: readonly Workspace[] | undefined
  isPending: boolean
  isError: boolean
}

export interface AuditWorkspaceScope<Workspace> {
  /** The workspace the link named, once it matches one the organization owns. */
  workspace: Workspace | undefined
  /** The list has not answered yet, so the feed must not read the whole organization meanwhile. */
  isPending: boolean
  /**
   * The lookup failed, so whether the workspace exists is unknown. Kept apart from `isUnresolved`:
   * telling an admin their workspace is not part of the organization because a request timed out is
   * a wrong answer, not a cautious one. Refresh retries this lookup alongside the feed.
   */
  isUnavailable: boolean
  /**
   * The link named a workspace this organization does not have. The feed stays closed rather than
   * falling back to the organization: dropping the filter would answer a request for one workspace's
   * history with everybody's, under a URL that still claims to be scoped, and the export would follow.
   */
  isUnresolved: boolean
  /** The feed can answer the scope the URL asks for: the gate on presenting, refreshing or exporting. */
  isAnswerable: boolean
  /** Whether the feed's query may run. A failed lookup keeps its last rows out through `isAnswerable`. */
  feedEnabled: boolean
  /** Text for the chip that clears the scope, rendered for an unresolved scope too. */
  chipLabel: string | null
}

/**
 * Resolves a deep-linked workspace scope for the audit feed. Only the id lives in the URL, and the
 * filter applies once it matches a workspace the organization actually owns. An audit feed is the
 * one place where widening is the dangerous direction, so every undecided answer fails closed.
 */
export function resolveAuditWorkspaceScope<Workspace extends { id: string; name: string }>(
  workspaceId: string | null,
  lookup: WorkspaceLookup<Workspace>
): AuditWorkspaceScope<Workspace> {
  const workspace = workspaceId ? lookup.data?.find((entry) => entry.id === workspaceId) : undefined
  const isPending = Boolean(workspaceId) && lookup.isPending
  const isUnavailable = Boolean(workspaceId) && lookup.isError
  const isUnresolved = Boolean(workspaceId) && !isPending && !isUnavailable && !workspace
  return {
    workspace,
    isPending,
    isUnavailable,
    isUnresolved,
    isAnswerable: !isPending && !isUnresolved && !isUnavailable,
    feedEnabled: !isPending && !isUnresolved,
    chipLabel: workspaceId
      ? `Workspace: ${workspace?.name ?? (isUnavailable ? 'unavailable' : 'not found')}`
      : null,
  }
}

/**
 * The time window a URL asks for. 'Custom range' is only honored with both bounds present — a
 * partial deep link falls back to the default preset window instead of silently querying unbounded.
 */
export function resolveAuditTimeRange(
  url: { timeRange: TimeRange; startDate: string | null; endDate: string | null },
  fallback: TimeRange
) {
  const customStart = url.startDate ?? ''
  const customEnd = url.endDate ?? ''
  const timeRange =
    url.timeRange === 'Custom range' && (!customStart || !customEnd) ? fallback : url.timeRange
  return { timeRange, customStart, customEnd }
}

/**
 * What a refresh may read. `refetch` ignores `enabled`, so this repeats the gate: while the scope is
 * unanswerable the feed's filter carries no workspace, and refreshing it would issue exactly the
 * organization-wide read the gate exists to prevent. The lookup is what has to succeed for a closed
 * feed to reopen, so it is retried whenever a scope asked for it.
 */
export function auditRefreshReads(scope: { isAnswerable: boolean }, workspaceId: string | null) {
  return { feed: scope.isAnswerable, workspaces: Boolean(workspaceId) }
}

/**
 * Entries the feed is allowed to present.
 *
 * A disabled query still serves whatever is cached under its key, and an unresolved
 * workspace scope resolves to the same key as the unscoped feed — so an admin looking
 * at the organization-wide feed who then followed a stale scoped link kept those rows
 * on screen, with Export still armed against them. The scope a link asks for is a
 * ceiling, so when it cannot be honoured the feed presents nothing rather than
 * whatever it happens to be holding.
 */
export function presentableAuditEntries(
  pages: AuditLogPage[] | undefined,
  isScopeAnswerable: boolean
): AuditLogEntry[] {
  if (!isScopeAnswerable || !pages) return []
  return pages.flatMap((page) => page.data)
}

/**
 * Whether Export may run. `isScopeAnswerable` is explicit, not just implied by the empty entries it
 * produces: the export is the action that leaves the building, so the condition that makes it safe
 * belongs where it is read.
 */
export function canExportAuditLogs(state: {
  isScopeAnswerable: boolean
  entryCount: number
  isExporting: boolean
  isPlaceholderData: boolean
}): boolean {
  return (
    state.isScopeAnswerable &&
    state.entryCount > 0 &&
    !state.isExporting &&
    !state.isPlaceholderData
  )
}
