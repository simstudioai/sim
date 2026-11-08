import type { IconName } from '@sim/emcn/catalog/icon-geometry'

/**
 * The workspace's own pages read these shapes. Fixtures fill them on the server today; a live
 * adapter in `lib/data` will map the existing contracts onto the same props.
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

export interface WorkspacePerson {
  id: string
  name: string
  src?: string
}

/** Semantic ink for a status written as text: no badge, no glyph. */
type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface StatusText {
  label: string
  tone: StatusTone
}

/** A workspace item an issue or a shipped change touched. */
export interface WorkspaceChange {
  id: string
  name: string
  /** What kind of item it is, written for people: `Workflow`, `Table`, `Notion page`. */
  type: string
  /** Where it lives: a product path inside this app or an absolute provider URL. Absent when it has no page. */
  href?: string
  icon?: IconName
  providerId?: string
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
  /** The column a row is read by; it takes the remaining width. */
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

/* Changelog */

export interface ChangelogEntry {
  id: string
  title: string
  description: string
  appliedAt: number
  contributor: WorkspacePerson
  issueId: string
}

export interface ChangelogData {
  workspace: WorkspaceSummary
  referenceTime: number
  updatedAt: number
  entries: readonly ChangelogEntry[]
}

export interface ChangelogDetail extends ChangelogEntry {
  workspace: WorkspaceSummary
  referenceTime: number
  /** Paragraphs that follow the description. */
  body: readonly string[]
  workspaceChanges: readonly WorkspaceChange[]
}

/* Logs */

export type RunStatus = 'completed' | 'failed' | 'waiting' | 'running' | 'cancelled'

export interface RunTrigger {
  label: string
  icon?: IconName
  providerId?: string
}

export interface RunSummary {
  /** The immutable execution identifier. */
  id: string
  workflow: { id: string; name: string }
  status: RunStatus
  trigger: RunTrigger
  startedAt: number
  durationMs: number | null
  /** Compute Units. `null` is unknown, never zero. */
  cu: number | null
}

export interface RunsData {
  workspace: WorkspaceSummary
  referenceTime: number
  runs: readonly RunSummary[]
  /** Runs that arrived after the list's snapshot; the new-runs action brings them in. */
  incoming: readonly RunSummary[]
}

type TraceKind =
  | 'agent'
  | 'model'
  | 'tool'
  | 'mcp'
  | 'loop'
  | 'iteration'
  | 'parallel'
  | 'branch'
  | 'workflow'
  | 'block'

export type TracePayload =
  | { format: 'json' | 'text'; content: string }
  | { format: 'withheld'; reason: string }

export interface TraceSpan {
  id: string
  name: string
  kind: TraceKind
  /** Provider identity for model turns and integration calls. */
  providerId?: string
  status: 'success' | 'error' | 'handled' | 'running'
  /** Offset from the run's start, on the root clock. */
  startMs: number
  durationMs: number
  context: readonly { id: string; label: string; value: string }[]
  input?: TracePayload
  output?: TracePayload
  notice?: { tone: 'neutral' | 'warning' | 'danger'; title: string; message: string }
  children?: readonly TraceSpan[]
}

export interface RunDetail extends RunSummary {
  workspace: WorkspaceSummary
  referenceTime: number
  version: string
  trace: readonly TraceSpan[]
}
