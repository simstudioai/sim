/**
 * The entities the project view shows that have no real source yet: issues, changelog,
 * chats and the overlay packs that hold them. Fixtures implement them; nothing here pulls data.
 */

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled'
export type Priority = 0 | 1 | 2 | 3 | 4
export type AgentState = 'pending' | 'active' | 'awaitingInput' | 'error' | 'complete' | 'stale'
export type FeedbackSource = 'slack' | 'email' | 'intercom' | 'pagerduty'
export type TrackerKind = 'sim' | 'linear' | 'jira'

export interface Person {
  id: string
  name: string
}

export interface Delegate {
  kind: 'agent' | 'workflow' | 'sim'
  name: string
}

export interface Report {
  source: FeedbackSource
  channel: string
  author: string
  text: string
  at: string
}

export interface PlanStep {
  label: string
  status: 'pending' | 'inProgress' | 'completed' | 'canceled'
}

export interface Activity {
  kind: 'thought' | 'action' | 'elicitation' | 'response' | 'error'
  text: string
  at: string
}

/** A ticket in Linear, Jira, or GitHub that a Sim issue points at. */
export interface LinkedTicket {
  system: 'linear' | 'jira' | 'github'
  key: string
  title: string
  status: string
}

export interface Issue {
  key: string
  workspaceId: string
  title: string
  status: IssueStatus
  priority: Priority
  owner: Person
  delegate?: Delegate
  agent?: { state: AgentState; label: string }
  project?: string
  labels: string[]
  due?: string
  description: string
  research?: { cause: string; related: string[] }
  reports: Report[]
  plan: PlanStep[]
  activity: Activity[]
  releaseId?: string
  resources: { kind: 'table' | 'workflow' | 'dashboard' | 'knowledge' | 'file'; name: string }[]
  investigation?: Investigation
  /** Tickets in external trackers this Sim issue covers; derived from the project tracker when omitted. */
  linked?: LinkedTicket[]
}

export interface TriageProposal {
  id: string
  workspaceId: string
  title: string
  summary: string
  reports: Report[]
  suggestion: { kind: 'new' } | { kind: 'duplicate'; key: string; confidence: number }
  at: string
}

export interface Release {
  id: string
  workspaceId: string
  name: string
  date: string
  notes: string
  notified: number
}

/**
 * An overlay pack: the issues, changelog, tracker and feedback sources a real workspace shows
 * while those entities have no real source. `match` picks the pack from the workspace name.
 */
export interface Workspace {
  id: string
  name: string
  description: string
  /** Picks this pack when the workspace name matches; a name-independent signal is `matchWorkflows`. */
  match?: RegExp
  /** Picks this pack when the workspace holds a workflow with one of these exact names. */
  matchWorkflows?: string[]
  tracker: { kind: TrackerKind; label: string; synced?: string }
  feedbackSources: { source: FeedbackSource; label: string }[]
  dashboards: string[]
  needsYou: number
}

export interface Chat {
  id: string
  title: string
  workspaceId?: string
  owner?: string
  /** Relative time of the last message, as the sidebar shows it. */
  age: string
}

export interface ResourceItem {
  id: string
  name: string
  meta: string
  updated: string
  owner: string
}

export interface RunBlock {
  id: string
  name: string
  type: string
  /** Offset from the run start, in ms. */
  start: number
  duration: number
  depth: number
  output?: string
  highlight?: boolean
}

export type Evidence =
  | { type: 'run'; runId: string; summary: string; blocks: RunBlock[] }
  | { type: 'runs'; title: string; columns: string[]; rows: string[][]; flagged: number[] }
  | {
      type: 'diff'
      title: string
      subtitle: string
      lines: { kind: 'add' | 'del' | 'ctx'; text: string }[]
    }

export interface InvestigationStep {
  at: string
  kind: 'feedback' | 'check' | 'workflow' | 'runs' | 'run' | 'config' | 'history' | 'conclusion'
  title: string
  detail?: string
  evidence?: Evidence
}

export interface SourceMessage {
  author: string
  channel: string
  at: string
  text: string
}

export type Origin =
  | { kind: 'slack'; message: SourceMessage; thread: SourceMessage[] }
  | {
      kind: 'kbQuery'
      knowledgeBase: string
      query: string
      at: string
      detail: string
      answers: { answer: string; cites: string }[]
    }

export interface SourceDoc {
  system: 'confluence'
  title: string
  space: string
  author: string
  updated: string
  /** Paragraphs from the page; `highlight` marks the sentence that conflicts. */
  excerpt: string[]
  highlight: string
}

export interface InvestigationSource {
  kind: 'slack' | 'workflow' | 'logs' | 'history'
  label: string
}

export interface Investigation {
  workflow: { name: string; version: string; nextVersion: string }
  summary: { label: string; text: string }[]
  /** What started the investigation: a person in Slack, or Sim's own knowledge check. */
  origin: Origin
  /** Source documents that disagree, when the issue is about knowledge content. */
  documents?: SourceDoc[]
  sources: InvestigationSource[]
  timeline: InvestigationStep[]
  rootCause: {
    summary: string
    chain: string[]
    confidence: 'High' | 'Medium' | 'Low'
    confidenceReason: string
    block: { path: string; lines: string[] }
  }
  frequency: {
    query: string
    days: { date: string; count: number }[]
    stats: { label: string; value: string }[]
  }
  proposal: {
    summary: string
    diff: { kind: 'add' | 'del' | 'ctx'; text: string }[]
    tradeoff: string
    replay: string
    /** A document edit handed to a Sim chat for approval, instead of a workflow redeploy. */
    docEdit?: {
      system: 'confluence'
      page: string
      space: string
      lines: { kind: 'add' | 'del' | 'ctx'; text: string }[]
    }
  }
}

export interface ChangelogMetric {
  label: string
  before: number
  after: number
  unit?: string
  /** Lower is better for this metric (drives the delta color). */
  lowerIsBetter?: boolean
}

export interface ChangelogChart {
  title: string
  kind: 'bar' | 'line'
  unit?: string
  /** Daily values; the release day is `releaseIndex`. */
  values: number[]
  releaseIndex: number
}

/** A chat is where a person and their Sim made the change. */
export interface ChangeChat {
  id: string
  owner: string
}

export interface Change {
  text: string
  issues: string[]
  chat?: ChangeChat
  workflow?: string
}

export interface ChangelogEntry {
  id: string
  workspaceId: string
  date: string
  version: string
  workflows: string[]
  title: string
  summary: string
  changes: Change[]
  metrics: ChangelogMetric[]
  chart?: ChangelogChart
  reporters: string[]
  channel: string
  /** The newest shipped release streams a live "since release" counter. */
  live?: { label: string; goodLabel: string }
}

export interface DraftChange extends Change {
  workflow: string
  /** `approval` changes are held until their issue is approved. */
  state: 'ready' | 'approval'
}

export interface RunningWork {
  issue: string
  agent: string
  task: string
  step: string
  /** What the agent says it's doing, newest last; the card cycles through these. */
  narration: string[]
  progress: number
  startedMinutesAgo: number
  chat: ChangeChat
}

export interface DraftRelease {
  workspaceId: string
  versions: { workflow: string; from: string; to: string }[]
  changes: DraftChange[]
  running: RunningWork[]
  chart: ChangelogChart
  /** Chart marker for the pending release. */
  marker: string
  /** What the shipped entry says once Release is clicked. */
  release: { title: string; summary: string; reporters: string[]; channel: string }
}
