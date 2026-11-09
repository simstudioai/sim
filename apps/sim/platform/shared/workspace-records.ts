import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { getErrorMessage } from '@sim/utils/errors'

/**
 * The records the workspace's Changelog and Logs pages show, shared by their views, the server-gated
 * fixtures and the live adapters in `lib/data`, which map the existing contracts onto them.
 */

/**
 * The workspace a tab names in its heading. Example data carries the name; a live page carries only
 * the id, and the frame reads the name from the viewer's workspaces.
 */
export type TabWorkspace =
  | { id: string; name: string; description?: string }
  | { id: string; live: true }

export interface WorkspacePerson {
  id: string
  name: string
  src?: string
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

/* Changelog */

export interface ChangelogEntry {
  id: string
  title: string
  description: string
  appliedAt: number
  /** Who applied it; a release Sim published has none. */
  contributor?: WorkspacePerson
  /** The issue it came from; a release Sim published has none. */
  issueId?: string
  /** A published release's version label, `1.4.0`. */
  version?: string
}

export interface ChangelogData {
  workspace: TabWorkspace
  referenceTime: number
  updatedAt: number
  entries: readonly ChangelogEntry[]
}

export interface ChangelogDetail extends ChangelogEntry {
  workspace: { id: string; name: string }
  referenceTime: number
  /** Paragraphs that follow the description. */
  body: readonly string[]
  /** What changed, one line each; a line made in a chat links to it. */
  changes?: readonly { id: string; text: string; href?: string }[]
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
  workspace: TabWorkspace
  referenceTime: number
  runs: readonly RunSummary[]
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
  /** The deployment that ran; a draft run has none. */
  version?: string
  trace: readonly TraceSpan[]
}

interface LiveQuery {
  data: unknown
  status: 'pending' | 'error' | 'success'
  error: unknown
  isFetching: boolean
  refetch: () => unknown
}

/**
 * How a live query reads to a workspace page: data it already holds stays on screen while a refresh
 * fails, and a first read that fails offers Retry with `failure` when the error has no message.
 */
export function queryRead(query: LiveQuery, failure: string) {
  if (query.data !== undefined) return { status: 'ready' as const }
  if (query.status === 'error')
    return {
      status: 'error' as const,
      message: getErrorMessage(query.error, failure),
      retrying: query.isFetching,
      onRetry: () => void query.refetch(),
    }
  return { status: 'pending' as const }
}
