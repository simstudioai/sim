import type { WorkspaceChange, WorkspacePerson } from '@/platform/shared/workspace-records'

/**
 * The Dashboard and Issues shapes, filled by the server-gated fixtures, and the read every workspace
 * page reports. The Changelog and Logs records, which live adapters also fill, are in
 * `shared/workspace-records.ts`.
 */

export interface WorkspaceSummary {
  id: string
  /** The prefix of the workspace's issue identifiers, `IT` in `IT-134`. */
  code: string
  name: string
  description: string
}

/**
 * How a page's read stands. Pending paints only the page's chrome; a failure keeps the chrome and
 * offers Retry where the content would be.
 */
export type WorkspaceRead =
  | { status: 'ready' }
  | { status: 'pending' }
  | { status: 'error'; message: string; retrying?: boolean; onRetry: () => void }

/** Semantic ink for a status written as text: no badge, no glyph. */
type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface StatusText {
  label: string
  tone: StatusTone
}

/* Dashboard */

export type DashboardUnit =
  | { kind: 'count' }
  | { kind: 'currency'; currency: string }
  | { kind: 'percent' }
  | { kind: 'duration' }

interface DashboardMetric {
  id: string
  label: string
  /** `null` is unavailable, which reads differently from zero. */
  value: number | null
  unit: DashboardUnit
}

type DashboardColumnKind =
  | 'text'
  | 'status'
  | 'number'
  | 'percent'
  | 'duration'
  | 'currency'
  | 'delta'

export interface DashboardColumn {
  key: string
  label: string
  kind: DashboardColumnKind
  /** The column a row is read by; it never leaves as the table narrows. */
  primary?: boolean
  currency?: string
}

export type DashboardCell = string | number | null | StatusText

interface DashboardTableRow {
  id: string
  values: Readonly<Partial<Record<string, DashboardCell>>>
}

export interface DashboardTableData {
  columns: readonly DashboardColumn[]
  rows: readonly DashboardTableRow[]
}

export interface AgentRosterItem {
  id: string
  name: string
  /** Context for the status, such as `since Oct 11`. */
  detail?: string
  status: StatusText
  /** Trailing text such as `1,204 requests`. */
  metadata: string
}

export type DashboardContent =
  | { kind: 'metrics'; metrics: readonly DashboardMetric[] }
  /** Counts over time; the shared trend chart reads its values as counts. */
  | { kind: 'trend'; points: readonly { label: string; value: number }[] }
  /** Counts stacked by series; the shared bar chart reads its values as counts. */
  | {
      kind: 'bars'
      layout: 'stacked'
      series: readonly string[]
      bars: readonly { label: string; values: readonly number[] }[]
    }
  | {
      kind: 'bars'
      layout: 'grouped'
      unit: DashboardUnit
      series: readonly string[]
      bars: readonly { label: string; values: readonly number[] }[]
    }
  | {
      kind: 'signed'
      unit: DashboardUnit
      rows: readonly { id: string; label: string; value: number }[]
    }
  | {
      kind: 'donut'
      totalLabel: string
      segments: readonly { label: string; value: number }[]
    }
  | { kind: 'text'; paragraphs: readonly string[] }
  | { kind: 'roster'; agents: readonly AgentRosterItem[] }
  | ({ kind: 'table' } & DashboardTableData)

export interface DashboardSection {
  id: string
  title: string
  /** A choice that changes only this section, such as an agent or a breakdown. */
  choice?: { label: string; options: readonly { value: string; label: string }[] }
  /** The section's content for each choice value; a section without a choice reads `default`. */
  views: Readonly<Record<string, DashboardContent>>
}

/** One full-width section, or two of equal width. */
export interface DashboardRow {
  id: string
  sections: readonly DashboardSection[]
}

export interface DashboardData {
  workspace: WorkspaceSummary
  referenceTime: number
  updatedAt: number
  periods: readonly { value: string; label: string }[]
  /** The snapshot for each period; an empty record means no dashboard exists yet. */
  snapshots: Readonly<Record<string, readonly DashboardRow[]>>
}

/* Issues */

export type IssueState =
  | 'needs-review'
  | 'queued'
  | 'in-progress'
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'merged'
  | 'denied'
  | 'cancelled'

export type IssueGroup = 'review' | 'progress' | 'merged' | 'closed'

export interface IssueSummary {
  /** The workspace identifier, `IT-134`. */
  id: string
  number: number
  title: string
  createdAt: number
  state: IssueState
}

export interface IssuesData {
  workspace: WorkspaceSummary
  referenceTime: number
  issues: readonly IssueSummary[]
}

export interface DocumentChange {
  title: string
  provider: { id: string; name: string }
  section: string
  context: string
  lines: readonly { id: string; change: 'context' | 'removed' | 'added'; text: string }[]
  fromVersion: string
  toVersion: string
}

export type IssueOutcome = { id: string; label: string } & (
  | { kind: 'time'; at: number }
  | { kind: 'person'; person: WorkspacePerson }
  | { kind: 'text'; value: string }
  /** A product path for a linked fact, such as the shipped change. */
  | { kind: 'link'; value: string; href: string }
)

export interface IssueDetail extends IssueSummary {
  description: string
  workspace: WorkspaceSummary
  referenceTime: number
  outcomes: readonly IssueOutcome[]
  document?: DocumentChange
  workspaceChanges: readonly WorkspaceChange[]
  comparison?: {
    title: string
    columns: readonly { label: string; items: readonly string[] }[]
  }
  impact: readonly string[]
  excerpt?: { title: string; provider: { id: string; name: string }; source: string; quote: string }
  evidence?: { title: string } & DashboardTableData
  steps?: { title: string; steps: readonly { id: string; description: string }[] }
  /** The shipped change, once merged. */
  changelogEntryId?: string
  /** The integration a blocked run waits on. */
  blockedBy?: { providerId: string; name: string }
}
