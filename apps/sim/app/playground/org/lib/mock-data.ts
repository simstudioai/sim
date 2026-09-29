import {
  INFRA_ISSUES,
  INFRA_RELEASES,
  INFRA_TRIAGE,
  type Investigation,
} from '@/app/playground/org/lib/infra-data'
import { SUPPORT_ISSUES } from '@/app/playground/org/lib/support-data'

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

export interface Workspace {
  id: string
  name: string
  description: string
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

export const ORGANIZATION = { id: 'acme', name: 'Acme Inc' }

export const PEOPLE = {
  teddy: { id: 'teddy', name: 'Teddy Li' },
  ava: { id: 'ava', name: 'Ava Chen' },
  marcus: { id: 'marcus', name: 'Marcus Reid' },
  priya: { id: 'priya', name: 'Priya Shah' },
} satisfies Record<string, Person>

export const WORKSPACES: Workspace[] = [
  {
    id: 'infra',
    name: 'Infra analyzer',
    description: 'Investigates workflow issues from feedback and stops for approval',
    tracker: { kind: 'linear', label: 'Linear', synced: '1m ago' },
    feedbackSources: [{ source: 'slack', label: '#bot-feedback' }],
    dashboards: ['infra-analyzer'],
    needsYou: 1,
  },
  {
    id: 'support',
    name: 'Support desk',
    description: 'Answers, routes, and learns from customer tickets',
    tracker: { kind: 'linear', label: 'Linear', synced: '2m ago' },
    feedbackSources: [
      { source: 'slack', label: '#product-feedback' },
      { source: 'email', label: 'support@acme.com' },
      { source: 'intercom', label: 'Intercom' },
    ],
    dashboards: ['support-operations'],
    needsYou: 2,
  },
  {
    id: 'growth',
    name: 'Growth engine',
    description: 'Finds, enriches, and activates new leads',
    tracker: { kind: 'jira', label: 'Jira', synced: '4m ago' },
    feedbackSources: [{ source: 'slack', label: '#growth-ideas' }],
    dashboards: ['growth-funnel'],
    needsYou: 1,
  },
  {
    id: 'finance',
    name: 'Finance close',
    description: 'Reconciles spend and closes the books each month',
    tracker: { kind: 'sim', label: 'Sim tracker' },
    feedbackSources: [],
    dashboards: [],
    needsYou: 0,
  },
]

export const CHATS: Chat[] = [
  {
    id: 'c0',
    age: '5m',
    title: 'Is INF-412 safe to redeploy?',
    workspaceId: 'infra',
    owner: 'Teddy Li',
  },
  {
    id: 'c6',
    age: '18m',
    title: 'Stop the bot replying in untagged threads',
    workspaceId: 'infra',
    owner: 'Marcus Reid',
  },
  {
    id: 'c7',
    age: '2m',
    title: 'Let the bot follow up when it was tagged',
    workspaceId: 'infra',
    owner: 'Ava Chen',
  },
  {
    id: 'c8',
    age: '6m',
    title: 'Why didn’t Friday’s digest send?',
    workspaceId: 'infra',
    owner: 'Teddy Li',
  },
  {
    id: 'c9',
    age: '1h',
    title: 'Show investigation time in the digest',
    workspaceId: 'infra',
    owner: 'Priya Shah',
  },
  {
    id: 'c10',
    age: '12m',
    title: 'Refresh the refund answers',
    workspaceId: 'infra',
    owner: 'Ava Chen',
  },
  {
    id: 'c1',
    age: '12m',
    title: 'Why did churn scoring slow down?',
    workspaceId: 'support',
    owner: 'Teddy Li',
  },
  { id: 'c2', age: '3h', title: 'Draft Q4 nurture sequence', workspaceId: 'growth' },
  {
    id: 'c3',
    age: '41m',
    title: 'Fix Slack trigger double-fire',
    workspaceId: 'support',
    owner: 'Marcus Reid',
  },
  {
    id: 'c11',
    age: '2h',
    title: 'Draft billing macros',
    workspaceId: 'support',
    owner: 'Ava Chen',
  },
  {
    id: 'c12',
    age: '1d',
    title: 'Route billing to the billing agent',
    workspaceId: 'support',
    owner: 'Priya Shah',
  },
  {
    id: 'c13',
    age: '1d',
    title: 'Make escalations explain themselves',
    workspaceId: 'support',
    owner: 'Teddy Li',
  },
  {
    id: 'c15',
    age: '25m',
    title: 'Fix the refund policy contradiction',
    workspaceId: 'support',
    owner: 'Ava Chen',
  },
  {
    id: 'c14',
    age: '4m',
    title: 'Add Zendesk as a feedback source',
    workspaceId: 'support',
    owner: 'Marcus Reid',
  },
  { id: 'c4', age: '2d', title: 'Compare vendor spend Aug vs Sep', workspaceId: 'finance' },
  { id: 'c5', age: '3d', title: 'Summarize last week’s incidents' },
]

const OTHER_RELEASES: Release[] = [
  {
    id: 'r-support-v14',
    workspaceId: 'support',
    name: 'support-agent v14',
    date: 'Sep 27',
    notes: 'CSV exports stream instead of timing out; Slack replies stay in thread.',
    notified: 4,
  },
  {
    id: 'r-support-v13',
    workspaceId: 'support',
    name: 'support-agent v13',
    date: 'Sep 20',
    notes: 'Escalations include the full ticket history.',
    notified: 1,
  },
  {
    id: 'r-routing-v6',
    workspaceId: 'support',
    name: 'ticket-router v6',
    date: 'Sep 18',
    notes: 'Billing questions route to the billing agent first.',
    notified: 0,
  },
  {
    id: 'r-growth-v3',
    workspaceId: 'growth',
    name: 'lead-enricher v3',
    date: 'Sep 24',
    notes: 'Apollo enrichment retries on rate limits.',
    notified: 1,
  },
]

export const RELEASES: Release[] = [...INFRA_RELEASES, ...OTHER_RELEASES]

const slack = (author: string, text: string, at: string): Report => ({
  source: 'slack',
  channel: '#product-feedback',
  author,
  text,
  at,
})
const email = (author: string, text: string, at: string): Report => ({
  source: 'email',
  channel: 'support@acme.com',
  author,
  text,
  at,
})

const OTHER_TRIAGE: TriageProposal[] = [
  {
    id: 't1',
    workspaceId: 'support',
    title: 'Export to CSV times out on large tables',
    summary:
      'Likely the inline export reading every row before streaming. Reproduced on a 60k-row table; run 7f3a… timed out at 30s.',
    reports: [
      slack('Jess @ Northwind', 'export just spins forever on our leads table', '2h ago'),
      email('ops@contoso.com', 'CSV export failing since Tuesday', '5h ago'),
      slack('Dan @ Initech', 'any update on exports? blocking our weekly report', '1d ago'),
    ],
    suggestion: { kind: 'new' },
    at: '2h ago',
  },
  {
    id: 't2',
    workspaceId: 'support',
    title: 'Slack trigger fires twice in threads',
    summary: 'Same symptom as SUP-120: thread replies deliver both message and app_mention events.',
    reports: [slack('Rae @ Hooli', 'bot answered twice in the same thread again', '5h ago')],
    suggestion: { kind: 'duplicate', key: 'SUP-120', confidence: 82 },
    at: '5h ago',
  },
  {
    id: 't3',
    workspaceId: 'support',
    title: 'Dark mode for dashboards',
    summary: 'Feature request. 6 earlier reports already attached to SUP-98.',
    reports: [email('lee@globex.com', 'would love dashboards in dark mode', 'now')],
    suggestion: { kind: 'duplicate', key: 'SUP-98', confidence: 94 },
    at: 'now',
  },
  {
    id: 't4',
    workspaceId: 'growth',
    title: 'Referral link breaks on mobile Safari',
    summary: 'Query string is dropped by the redirect on iOS 17. No existing issue matches.',
    reports: [
      {
        source: 'slack',
        channel: '#growth-ideas',
        author: 'Priya Shah',
        text: 'referral links 404 from my phone',
        at: '3h ago',
      },
    ],
    suggestion: { kind: 'new' },
    at: '3h ago',
  },
]

export const TRIAGE: TriageProposal[] = [...INFRA_TRIAGE, ...OTHER_TRIAGE]

const done = (label: string): PlanStep => ({ label, status: 'completed' })
const doing = (label: string): PlanStep => ({ label, status: 'inProgress' })
const todo = (label: string): PlanStep => ({ label, status: 'pending' })

const OTHER_ISSUES: Issue[] = [
  {
    key: 'SUP-131',
    workspaceId: 'support',
    title: 'Score every active account for churn risk weekly',
    status: 'in_progress',
    priority: 2,
    owner: PEOPLE.teddy,
    delegate: { kind: 'agent', name: 'churn-agent' },
    agent: { state: 'active', label: 'Scoring batch 3/9' },
    project: 'Retention Q4',
    labels: ['agent'],
    due: 'Sep 30',
    description:
      'Score every account active in the last 30 days and write the result to churn_signals so CS can prioritize outreach.',
    reports: [],
    plan: [
      done('Pull active accounts from Tables › accounts'),
      doing('Score each account with the churn model'),
      todo('Write results to churn_signals'),
      todo('Post the top 20 to #cs-team'),
    ],
    activity: [
      { kind: 'action', text: 'Queried accounts — 881 rows', at: '12m ago' },
      {
        kind: 'thought',
        text: '12 accounts are missing a plan field; scoring them as Free.',
        at: '9m ago',
      },
      { kind: 'action', text: 'Scored batch 2/9 — 196 accounts', at: '4m ago' },
      { kind: 'action', text: 'Scoring batch 3/9…', at: 'now' },
    ],
    resources: [
      { kind: 'table', name: 'churn_signals' },
      { kind: 'workflow', name: 'churn-agent' },
      { kind: 'dashboard', name: 'Support operations' },
    ],
  },
  {
    key: 'SUP-140',
    workspaceId: 'support',
    title: 'Draft reply macros for the top 5 billing questions',
    status: 'in_progress',
    priority: 3,
    owner: PEOPLE.ava,
    delegate: { kind: 'sim', name: 'Sim' },
    agent: { state: 'awaitingInput', label: 'Needs your approval' },
    project: 'Billing deflection',
    labels: [],
    description: 'Use last month’s billing tickets to draft macros the support agent can reuse.',
    reports: [],
    plan: [
      done('Cluster billing tickets by intent'),
      doing('Draft 5 macros'),
      todo('Publish to knowledge base'),
    ],
    activity: [
      { kind: 'action', text: 'Read 412 billing tickets from Tables › tickets', at: '1h ago' },
      {
        kind: 'response',
        text: 'Drafted 5 macros. Refund wording differs from policy doc — which should win?',
        at: '20m ago',
      },
      {
        kind: 'elicitation',
        text: 'Approve the refund wording from the policy doc or from recent replies?',
        at: '20m ago',
      },
    ],
    resources: [
      { kind: 'knowledge', name: 'Billing policies' },
      { kind: 'table', name: 'tickets' },
    ],
  },
  {
    key: 'SUP-120',
    workspaceId: 'support',
    title: 'Slack trigger fires twice on thread replies',
    status: 'blocked',
    priority: 1,
    owner: PEOPLE.marcus,
    delegate: { kind: 'workflow', name: 'slack-support-bot' },
    agent: { state: 'error', label: 'Failed 3× · auth expired' },
    project: 'Slack support',
    labels: ['bug'],
    description:
      'Thread replies deliver both message and app_mention events, so the bot answers twice.',
    research: {
      cause: 'Both event subscriptions are enabled and the dedupe key ignores thread_ts.',
      related: ['SUP-88', 'run 91c2…'],
    },
    reports: [
      slack('Rae @ Hooli', 'bot answered twice in the same thread', '3d ago'),
      slack('Jon @ Umbrella', 'double replies in #help', '4d ago'),
    ],
    plan: [done('Reproduce in staging'), { label: 'Patch dedupe key', status: 'canceled' }],
    activity: [
      { kind: 'action', text: 'Reproduced with a test thread', at: '2d ago' },
      {
        kind: 'error',
        text: 'Slack credential expired — reconnect in Credentials to continue',
        at: '1h ago',
      },
    ],
    resources: [{ kind: 'workflow', name: 'slack-support-bot' }],
  },
  {
    key: 'SUP-137',
    workspaceId: 'support',
    title: 'Route billing questions to the billing agent first',
    status: 'in_progress',
    priority: 3,
    owner: PEOPLE.priya,
    delegate: { kind: 'workflow', name: 'ticket-router' },
    agent: { state: 'complete', label: '42 runs · all passed' },
    project: 'Billing deflection',
    labels: [],
    description: 'Detect billing intent and hand off before the general agent answers.',
    reports: [],
    plan: [done('Add intent classifier'), done('Shadow-run on live traffic')],
    activity: [
      {
        kind: 'response',
        text: 'Shadow run matched human routing on 97% of 42 tickets.',
        at: '3h ago',
      },
    ],
    resources: [{ kind: 'workflow', name: 'ticket-router' }],
  },
  {
    key: 'SUP-142',
    workspaceId: 'support',
    title: 'Summarize escalations for the weekly review',
    status: 'todo',
    priority: 3,
    owner: PEOPLE.teddy,
    labels: [],
    description: 'Every Friday, summarize escalated tickets with the reason and the owner.',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'SUP-98',
    workspaceId: 'support',
    title: 'Dark mode for dashboards',
    status: 'backlog',
    priority: 4,
    owner: PEOPLE.ava,
    labels: ['feature request'],
    description: 'Customers want dashboards to follow the app theme.',
    reports: [
      email('lee@globex.com', 'would love dashboards in dark mode', '1w ago'),
      slack('Sam @ Stark', 'dashboards blind me at night', '2w ago'),
    ],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'SUP-145',
    workspaceId: 'support',
    title: 'Add Zendesk as a feedback source',
    status: 'backlog',
    priority: 0,
    owner: PEOPLE.marcus,
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'SUP-151',
    workspaceId: 'support',
    title: 'CSV export streams instead of timing out',
    status: 'done',
    priority: 1,
    owner: PEOPLE.teddy,
    delegate: { kind: 'agent', name: 'fix-agent' },
    agent: { state: 'complete', label: 'Shipped' },
    project: 'Tables reliability',
    labels: ['bug'],
    description: 'Large table exports time out after 30s.',
    research: {
      cause: 'Export reads every row into memory before streaming.',
      related: ['SUP-88', 'run 7f3a…', 'KB › Tables limits'],
    },
    reports: [
      slack('Jess @ Northwind', 'export just spins forever', '6d ago'),
      email('ops@contoso.com', 'CSV export failing since Tuesday', '6d ago'),
      slack('Dan @ Initech', 'blocking our weekly report', '7d ago'),
    ],
    plan: [done('Reproduce on a 60k-row table'), done('Stream rows in pages'), done('Deploy')],
    activity: [
      {
        kind: 'response',
        text: 'Shipped in support-agent v14. Replied to 3 reporters.',
        at: 'Sep 27',
      },
    ],
    releaseId: 'r-support-v14',
    resources: [{ kind: 'workflow', name: 'support-agent' }],
  },
  {
    key: 'SUP-150',
    workspaceId: 'support',
    title: 'Slack replies stay in the original thread',
    status: 'done',
    priority: 2,
    owner: PEOPLE.marcus,
    delegate: { kind: 'workflow', name: 'slack-support-bot' },
    labels: [],
    description: '',
    reports: [slack('Rae @ Hooli', 'bot replies land in the channel, not the thread', '9d ago')],
    plan: [],
    activity: [],
    releaseId: 'r-support-v14',
    resources: [],
  },
  {
    key: 'SUP-133',
    workspaceId: 'support',
    title: 'Escalations include the full ticket history',
    status: 'done',
    priority: 2,
    owner: PEOPLE.ava,
    labels: [],
    description: '',
    reports: [email('help@acme-partner.io', 'escalated tickets lose context', '2w ago')],
    plan: [],
    activity: [],
    releaseId: 'r-support-v13',
    resources: [],
  },
  {
    key: 'SUP-129',
    workspaceId: 'support',
    title: 'Billing questions route to the billing agent',
    status: 'done',
    priority: 3,
    owner: PEOPLE.priya,
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    releaseId: 'r-routing-v6',
    resources: [],
  },
  {
    key: 'GRO-137',
    workspaceId: 'growth',
    title: 'Enrich inbound leads with Apollo',
    status: 'in_progress',
    priority: 2,
    owner: PEOPLE.priya,
    delegate: { kind: 'workflow', name: 'lead-enricher' },
    agent: { state: 'complete', label: '310 runs · 2 retried' },
    project: 'Inbound automation',
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [{ kind: 'table', name: 'leads' }],
  },
  {
    key: 'GRO-140',
    workspaceId: 'growth',
    title: 'Draft the Q4 nurture sequence',
    status: 'in_progress',
    priority: 3,
    owner: PEOPLE.teddy,
    delegate: { kind: 'sim', name: 'Sim' },
    agent: { state: 'awaitingInput', label: 'Pick 1 of 3 variants' },
    project: 'Lifecycle',
    labels: [],
    description: '',
    reports: [],
    plan: [done('Pull last quarter’s best emails'), doing('Draft 3 variants')],
    activity: [{ kind: 'elicitation', text: 'Which tone should the sequence use?', at: '40m ago' }],
    resources: [],
  },
  {
    key: 'GRO-142',
    workspaceId: 'growth',
    title: 'Lead scoring v2',
    status: 'todo',
    priority: 2,
    owner: PEOPLE.ava,
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'GRO-118',
    workspaceId: 'growth',
    title: 'Apollo enrichment retries on rate limits',
    status: 'done',
    priority: 2,
    owner: PEOPLE.priya,
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    releaseId: 'r-growth-v3',
    resources: [],
  },
]

export const ISSUES: Issue[] = [...INFRA_ISSUES, ...SUPPORT_ISSUES, ...OTHER_ISSUES]

export const STATUS_ORDER: IssueStatus[] = [
  'in_progress',
  'blocked',
  'todo',
  'backlog',
  'done',
  'canceled',
]

export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

export interface ResourceItem {
  id: string
  name: string
  meta: string
  updated: string
  owner: string
}

export const RESOURCES: Record<
  'workflows' | 'logs' | 'tables' | 'files' | 'knowledge' | 'credentials',
  ResourceItem[]
> = {
  workflows: [
    {
      id: 'w1',
      name: 'slack-support-bot',
      meta: 'Deployed · v14',
      updated: '2026-09-22',
      owner: 'Ava Chen',
    },
    {
      id: 'w2',
      name: 'infra-analyzer',
      meta: 'Deployed · v9',
      updated: '2026-09-27',
      owner: 'Marcus Reid',
    },
    {
      id: 'w3',
      name: 'incident-digest',
      meta: 'Deployed · v2',
      updated: '2026-09-15',
      owner: 'Teddy Li',
    },
  ],
  logs: [
    {
      id: 'l1',
      name: 'infra-analyzer · INF-412',
      meta: 'Paused · awaiting approval',
      updated: '2026-09-28T09:18:00Z',
      owner: 'Slack',
    },
    {
      id: 'l2',
      name: 'slack-support-bot',
      meta: 'Success · 4.2s',
      updated: '2026-09-28T09:11:00Z',
      owner: 'Slack',
    },
    {
      id: 'l3',
      name: 'slack-support-bot',
      meta: 'Success · 3.9s',
      updated: '2026-09-28T09:10:00Z',
      owner: 'Slack',
    },
    {
      id: 'l4',
      name: 'infra-analyzer · INF-409',
      meta: 'Running · 6m',
      updated: '2026-09-28T09:02:00Z',
      owner: 'Slack',
    },
    {
      id: 'l5',
      name: 'incident-digest',
      meta: 'Skipped',
      updated: '2026-09-26T16:00:00Z',
      owner: 'Schedule',
    },
  ],
  tables: [
    {
      id: 't1',
      name: 'infra_investigations',
      meta: '412 rows',
      updated: '2026-09-28',
      owner: 'Marcus Reid',
    },
    {
      id: 't2',
      name: 'alert_history',
      meta: '9,880 rows',
      updated: '2026-09-28',
      owner: 'Priya Shah',
    },
  ],
  files: [
    {
      id: 'f1',
      name: 'Infra analyzer.dashboard',
      meta: 'Dashboard',
      updated: '2026-09-27',
      owner: 'Teddy Li',
    },
    { id: 'f2', name: 'INF-412 root cause.md', meta: '6 KB', updated: '2026-09-28', owner: 'Sim' },
  ],
  knowledge: [
    {
      id: 'k1',
      name: 'Runbooks',
      meta: '64 docs · GitHub',
      updated: '2026-09-26',
      owner: 'Marcus Reid',
    },
    {
      id: 'k2',
      name: 'Postmortems',
      meta: '38 docs · Notion',
      updated: '2026-09-22',
      owner: 'Priya Shah',
    },
  ],
  credentials: [
    {
      id: 'cr1',
      name: 'Grafana Cloud · Tempo + Loki',
      meta: 'Connected',
      updated: '2026-09-01',
      owner: 'Marcus Reid',
    },
    {
      id: 'cr2',
      name: 'Postgres · sim-prod (read-only)',
      meta: 'Connected',
      updated: '2026-08-20',
      owner: 'Priya Shah',
    },
    {
      id: 'cr3',
      name: 'Slack · Acme',
      meta: 'Connected',
      updated: '2026-09-10',
      owner: 'Teddy Li',
    },
    {
      id: 'cr4',
      name: 'PagerDuty',
      meta: 'Connected',
      updated: '2026-07-30',
      owner: 'Marcus Reid',
    },
  ],
}

export function workspaceById(id: string): Workspace {
  const workspace = WORKSPACES.find((w) => w.id === id)
  if (!workspace) throw new Error(`Unknown mock workspace ${id}`)
  return workspace
}

export function issueByKey(key: string): Issue | undefined {
  return ISSUES.find((issue) => issue.key === key)
}

const TRACKER_PREFIX: Record<string, string> = { infra: 'BOT', support: 'SUPT', growth: 'GRW' }

const TRACKER_STATUS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

/**
 * The external tickets a Sim issue covers. A Sim issue is the brief plus the evidence;
 * it can point at several tickets across trackers, each keeping its own key and status.
 */
export function linkedTickets(issue: Issue): LinkedTicket[] {
  if (issue.linked) return issue.linked
  const { tracker } = workspaceById(issue.workspaceId)
  const prefix = TRACKER_PREFIX[issue.workspaceId]
  if (tracker.kind === 'sim' || !prefix) return []
  const number = Number(issue.key.split('-')[1]) - 290
  return [
    {
      system: tracker.kind,
      key: `${prefix}-${number}`,
      title: issue.title,
      status: TRACKER_STATUS[issue.status],
    },
  ]
}

export function ticketUrl(ticket: LinkedTicket): string {
  if (ticket.system === 'linear') return `https://linear.app/acme/issue/${ticket.key}`
  if (ticket.system === 'jira') return `https://acme.atlassian.net/browse/${ticket.key}`
  return `https://github.com/acme/app/issues/${ticket.key.replace(/\D/g, '')}`
}
