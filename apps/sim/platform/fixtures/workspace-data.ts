import 'server-only'
import type { ShellWorkspace } from '@/platform/app/(shell)/_components/model'
import type {
  ChangelogData,
  ChangelogDetail,
  ChangelogEntry,
  DashboardContent,
  DashboardData,
  DashboardRow,
  DashboardSection,
  DashboardTableData,
  IssueDetail,
  IssueOutcome,
  IssueState,
  IssueSummary,
  RunDetail,
  RunStatus,
  RunSummary,
  RunTrigger,
  StatusText,
  TracePayload,
  TraceSpan,
  WorkspaceChange,
  WorkspacePerson,
  WorkspaceSummary,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import type { Scenario } from '@/platform/fixtures'
import { FIXTURE_NOW } from '@/platform/fixtures/clock'
import nina from '@/platform/fixtures/media/attendee-1.jpg'
import alex from '@/platform/fixtures/media/attendee-2.jpg'
import maya from '@/platform/fixtures/media/attendee-3.jpg'
import { runPayloads } from '@/platform/fixtures/run-payloads'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatCalendarDate } from '@/platform/shared/time'

/**
 * Example data for a workspace's Dashboard, Issues, Changelog and Logs. The loader passes the shell's
 * workspace in, so names and workflows match the sidebar and the composer; merged issues are the
 * shipped history.
 */

/* Common */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A stable sequence per workspace and page, so every render of a scenario agrees. */
function seeded(...parts: string[]) {
  let state = 2166136261
  for (const character of parts.join('/')) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]
}

function between(random: () => number, low: number, high: number) {
  return low + Math.floor(random() * (high - low + 1))
}

/** A name with no break opportunity, the widest a label can be asked to hold. */
const UNBROKEN =
  'InternationalCustomerOperationsEscalationAndRenewalForecastingWorkflowForEnterpriseAccounts'

const LONG_SENTENCE =
  'When a renewal crosses regions, the agent now reconciles the account owner, the regional billing entity and the contract amendments before it drafts the renewal brief, so finance and the account team review one consistent record instead of three partial ones.'

const PEOPLE: readonly WorkspacePerson[] = [
  { id: 'emir', name: 'Emir Karabeg' },
  { id: 'nina', name: 'Nina Patel', src: nina.src },
  { id: 'alex', name: 'Alex Morgan', src: alex.src },
  { id: 'maya', name: 'Maya Chen', src: maya.src },
  { id: 'waleed', name: 'Waleed Latif' },
  { id: 'sofia', name: 'Sofia Alvarez' },
  { id: 'daniel', name: 'Daniel Okafor' },
  { id: 'hannah', name: 'Hannah Becker' },
  { id: 'kenji', name: 'Kenji Watanabe' },
  { id: 'amara', name: 'Amara Nwosu' },
  { id: 'lucas', name: 'Lucas Moreau' },
]

const STRESS_PEOPLE: readonly WorkspacePerson[] = [
  ...PEOPLE,
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `contributor-${index}`,
    name:
      index === 0
        ? 'Maximiliana Alexandrina Featherstonehaugh-Vanderbilt-Montgomery'
        : index === 1
          ? UNBROKEN
          : `Regional operations contributor ${index + 1}`,
  })),
]

function workspacePeople(scenario: Scenario) {
  return scenario === 'stress' ? STRESS_PEOPLE : PEOPLE
}

const DESCRIPTIONS: Record<string, string> = {
  operations: 'Agents that keep internal operations running across every team.',
  revenue: 'Pipeline, renewals and forecasting for the revenue organization.',
  finance: 'Close, reconciliation and spend controls for finance.',
  it: 'Requests, access and device management for the IT service desk.',
}

const CODES: Record<string, string> = { operations: 'OPS', it: 'IT', finance: 'FIN' }

function codeFor(id: string, name: string) {
  if (CODES[id]) return CODES[id]
  const initials = name
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length > 2 || /^[A-Z]{2,}$/.test(word))
    .map((word) => word[0].toUpperCase())
    .join('')
  return (initials.length >= 2 ? initials : name.replace(/[^A-Za-z]/g, '').slice(0, 3))
    .slice(0, 4)
    .toUpperCase()
}

function workspaceSummary(scenario: Scenario, workspace: ShellWorkspace): WorkspaceSummary {
  return {
    id: workspace.id,
    code: codeFor(workspace.id, workspace.name),
    name: workspace.name,
    description:
      scenario === 'stress'
        ? `${LONG_SENTENCE} ${UNBROKEN}`
        : (DESCRIPTIONS[workspace.id] ??
          `Agents, issues and shipped changes for ${workspace.name.toLowerCase()}.`),
  }
}

/** The workspace items an agent's change can touch. Only the provider page has somewhere to open. */
function workspaceItems(scenario: Scenario, workspace: ShellWorkspace): WorkspaceChange[] {
  const workflow = (index: number, fallback: string) => {
    const item = workspace.workflows?.[index]
    return {
      id: `workflow-${item?.id ?? fallback}`,
      name: item?.name ?? fallback,
      type: 'Workflow',
      icon: 'I118' as const,
    }
  }
  return [
    workflow(0, 'Lead enrichment'),
    workflow(1, 'Account review'),
    {
      id: 'table-escalations',
      name: scenario === 'stress' ? UNBROKEN : 'Escalation queue',
      type: 'Table',
      icon: 'I033',
    },
    {
      id: 'notion-runbook',
      name: 'Access request runbook',
      type: 'Notion page',
      providerId: 'notion',
      href: 'https://www.notion.so',
    },
    {
      id: 'knowledge-policies',
      name: 'Security policies',
      type: 'Knowledge base',
      icon: 'I004',
    },
    {
      id: 'file-handbook',
      name: 'Support handbook.md',
      type: 'File',
      icon: 'I015',
    },
  ]
}

/* Issues */

interface IssueTemplate {
  title: string
  state: IssueState
  ageHours: number
  description: string
}

const FULL_ISSUES: readonly IssueTemplate[] = [
  {
    title: 'Route expired access requests to the regional owner before escalating',
    state: 'needs-review',
    ageHours: 0.4,
    description:
      'Access requests that wait more than two days are escalated to the global queue, even when the regional owner is online. Route them to the owner listed for the requester’s region first, and escalate only when that owner does not respond within four working hours.',
  },
  {
    title:
      'Draft renewal briefs from the signed contract amendments instead of the original order form, so finance and the account team review the same figures',
    state: 'needs-review',
    ageHours: 3,
    description: LONG_SENTENCE,
  },
  {
    title: 'Merge the three onboarding checklists into one Notion page',
    state: 'stale',
    ageHours: 20,
    description:
      'New hires receive separate checklists from IT, People operations and their team lead. Combine them into one page so each step has a single owner and a single due date.',
  },
  {
    title: 'Add the device inventory table to laptop provisioning',
    state: 'queued',
    ageHours: 26,
    description:
      'Provisioning asks the requester for their current device, although the inventory table already records it. Read the table first and ask only when no device is assigned.',
  },
  {
    title: 'Retry Salesforce syncs with a smaller batch when the rate limit is reached',
    state: 'in-progress',
    ageHours: 30,
    description:
      'Nightly syncs fail when Salesforce returns a rate-limit response. Halve the batch and retry, up to three times, before reporting the sync as failed.',
  },
  {
    title: 'Post a daily incident summary to #it-operations',
    state: 'blocked',
    ageHours: 52,
    description:
      'Summarize resolved and open incidents every morning at 9:00 and post the summary to the operations channel.',
  },
  {
    title: 'Backfill missing cost centers on September invoices',
    state: 'failed',
    ageHours: 70,
    description:
      'Two hundred and twelve invoices from September have no cost center. Match each invoice to its purchase order and fill in the cost center from the order.',
  },
  {
    title: 'Tag VIP requesters so their tickets skip triage',
    state: 'merged',
    ageHours: 2,
    description:
      'Requests from the executive team wait in triage with every other ticket. Tag requesters from the VIP list so their tickets go straight to the senior queue.',
  },
  {
    title: 'Search the knowledge base before asking a person for help',
    state: 'merged',
    ageHours: 9,
    description:
      'The triage agent asks a person whenever it is unsure. Search the security and support knowledge bases first and cite the article it used.',
  },
  {
    title: 'Close duplicate password reset tickets automatically',
    state: 'merged',
    ageHours: 28,
    description:
      'People often file a second password reset while the first is still open. Close the duplicate, link it to the original and tell the requester which ticket to follow.',
  },
  {
    title: 'Reconcile license counts with the HR roster every night',
    state: 'merged',
    ageHours: 50,
    description:
      'Software licenses stay assigned after people leave. Compare assignments with the HR roster nightly and list licenses that can be reclaimed.',
  },
  {
    title: 'Summarize weekly access reviews for the security team',
    state: 'merged',
    ageHours: 120,
    description:
      'Security reviews access changes every Friday. Prepare a summary grouped by system, with every privileged change listed first.',
  },
  {
    title: 'Warn requesters when a shared drive is close to its quota',
    state: 'merged',
    ageHours: 220,
    description:
      'Shared drives stop accepting files at their quota. Warn the drive owners when a drive passes ninety percent.',
  },
  {
    title: 'Translate replies into the language of the original request',
    state: 'merged',
    ageHours: 400,
    description:
      'Replies are always written in English. Write the reply in the language the requester used, and keep the English version in the ticket history.',
  },
  {
    title: 'Grant administrator access automatically to on-call engineers',
    state: 'denied',
    ageHours: 44,
    description:
      'On-call engineers request administrator access during incidents. Grant it automatically for the duration of their shift.',
  },
  {
    title: 'Email customers directly from the escalation workflow',
    state: 'denied',
    ageHours: 160,
    description:
      'Escalated customers wait for the account owner to reply. Email them an acknowledgement directly from the workflow.',
  },
  {
    title: 'Move the asset register into a new table',
    state: 'cancelled',
    ageHours: 90,
    description:
      'The asset register is a spreadsheet attached to the handbook. Move it into a workspace table so agents can read it.',
  },
  {
    title: 'Rewrite the onboarding email in a friendlier tone',
    state: 'cancelled',
    ageHours: 300,
    description: 'Make the onboarding email shorter and warmer.',
  },
]

const STATES: readonly IssueState[] = [
  'needs-review',
  'needs-review',
  'queued',
  'in-progress',
  'blocked',
  'failed',
  'stale',
  'merged',
  'merged',
  'merged',
  'merged',
  'denied',
  'cancelled',
]

const STRESS_TITLES = [
  UNBROKEN,
  `${LONG_SENTENCE} ${LONG_SENTENCE}`,
  'Reconcile regional billing entities against signed amendments',
  'Escalate unanswered access requests after four working hours',
  'Summarize incident timelines for the weekly operations review',
  'Close duplicate tickets filed within ten minutes of each other',
]

function stressIssues(): IssueTemplate[] {
  const random = seeded('stress-issues')
  return Array.from({ length: 320 }, (_, index) => ({
    title: index < 2 ? STRESS_TITLES[index] : `${pick(random, STRESS_TITLES)} ${index + 1}`,
    state: index < STATES.length ? STATES[index] : pick(random, STATES),
    ageHours: index * 2.6 + random() * 2,
    description: index % 3 === 0 ? `${LONG_SENTENCE} ${UNBROKEN}` : LONG_SENTENCE,
  }))
}

function templates(scenario: Scenario): readonly IssueTemplate[] {
  if (scenario === 'empty') return []
  return scenario === 'stress' ? stressIssues() : FULL_ISSUES
}

const FIRST_NUMBER = { full: 118, stress: 1000, empty: 1 }

interface IssueRecord extends IssueSummary {
  description: string
  approver: WorkspacePerson
  resolvedAt: number
}

function issueRecords(scenario: Scenario, workspace: WorkspaceSummary): IssueRecord[] {
  const random = seeded(scenario, workspace.id, 'issues')
  const people = workspacePeople(scenario)
  const items = templates(scenario)
  return items.map((template, index) => {
    const number = FIRST_NUMBER[scenario] + items.length - index
    const createdAt = Math.round(FIXTURE_NOW - template.ageHours * HOUR)
    return {
      id: `${workspace.code}-${number}`,
      number,
      title: template.title,
      createdAt,
      state: template.state,
      description: template.description,
      approver: pick(random, people),
      resolvedAt: Math.round(
        createdAt + Math.max(MINUTE, (FIXTURE_NOW - createdAt) * (0.25 + random() * 0.6))
      ),
    }
  })
}

export function workspaceIssues(scenario: Scenario, shell: ShellWorkspace) {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return null
  return {
    workspace,
    referenceTime: FIXTURE_NOW,
    issues: issueRecords(scenario, workspace).map(({ id, number, title, createdAt, state }) => ({
      id,
      number,
      title,
      createdAt,
      state,
    })),
  }
}

/** Every merged issue, which is exactly the workspace's shipped history. */
function mergedIssues(scenario: Scenario, shell: ShellWorkspace) {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return []
  return issueRecords(scenario, workspace).filter((issue) => issue.state === 'merged')
}

function changelogEntryId(issueNumber: number) {
  return `ch-${issueNumber}`
}

function evidence(scenario: Scenario): DashboardTableData {
  if (scenario === 'stress')
    return {
      columns: [
        { key: 'failure', label: 'Failure type', kind: 'text', primary: true },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'requests', label: 'Requests', kind: 'number' },
        { key: 'recovered', label: 'Recovered', kind: 'percent' },
        { key: 'time', label: 'Avg time', kind: 'duration' },
        { key: 'cost', label: 'Cost', kind: 'currency', currency: 'USD' },
        { key: 'change', label: 'Change', kind: 'delta' },
      ],
      rows: Array.from({ length: 14 }, (_, index) => ({
        id: `failure-${index}`,
        values: {
          failure: index === 0 ? UNBROKEN : `${LONG_SENTENCE.slice(0, 40 + index * 9)}`,
          status:
            index % 3 === 0
              ? { label: 'Recovering', tone: 'accent' }
              : index % 3 === 1
                ? { label: 'Failing', tone: 'danger' }
                : { label: 'Stable', tone: 'neutral' },
          requests: index === 2 ? null : 1_284_392 - index * 81_233,
          recovered: index === 3 ? 0 : 0.984 - index * 0.061,
          time: 128_400 - index * 7_210,
          cost: index === 4 ? null : 1_204_880 - index * 52_310,
          change: index % 2 ? -0.184 + index * 0.01 : 0.326 - index * 0.02,
        },
      })),
    }
  return {
    columns: [
      { key: 'failure', label: 'Failure type', kind: 'text', primary: true },
      { key: 'requests', label: 'Requests', kind: 'number' },
      { key: 'recovered', label: 'Recovered', kind: 'percent' },
    ],
    rows: [
      { id: 'owner', values: { failure: 'Regional owner online', requests: 214, recovered: 0.86 } },
      { id: 'away', values: { failure: 'Owner away', requests: 61, recovered: 0.41 } },
      { id: 'missing', values: { failure: 'No owner on record', requests: 18, recovered: 0 } },
      { id: 'unknown', values: { failure: 'Region unknown', requests: 7, recovered: null } },
    ],
  }
}

function outcomes(issue: IssueRecord, workspaceId: string): IssueOutcome[] {
  const at = issue.resolvedAt
  const approver: IssueOutcome = {
    id: 'approved-by',
    label: 'Approved by',
    kind: 'person',
    person: issue.approver,
  }
  switch (issue.state) {
    case 'queued':
    case 'in-progress':
      return [approver, { id: 'approved', label: 'Approved', kind: 'time', at }]
    case 'blocked':
      return [approver, { id: 'waiting', label: 'Waiting on', kind: 'text', value: 'Slack' }]
    case 'failed':
      return [approver, { id: 'failed', label: 'Failed', kind: 'time', at }]
    case 'merged':
      return [
        approver,
        { id: 'merged', label: 'Merged', kind: 'time', at },
        {
          id: 'changelog',
          label: 'Changelog',
          kind: 'link',
          value: 'View change',
          href: workspacePath(workspaceId, `changelog/${changelogEntryId(issue.number)}`),
        },
      ]
    case 'denied':
      return [
        { id: 'denied-by', label: 'Denied by', kind: 'person', person: issue.approver },
        { id: 'denied', label: 'Denied', kind: 'time', at },
      ]
    case 'cancelled':
      return [
        { id: 'cancelled-by', label: 'Cancelled by', kind: 'person', person: issue.approver },
        { id: 'cancelled', label: 'Cancelled', kind: 'time', at },
      ]
    case 'stale':
      return [{ id: 'updated', label: 'Updated', kind: 'time', at }]
    default:
      return []
  }
}

export function workspaceIssue(
  scenario: Scenario,
  shell: ShellWorkspace,
  issueId: string
): IssueDetail | null {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return null
  const issue = issueRecords(scenario, workspace).find((item) => item.id === issueId)
  if (!issue) return null
  const items = workspaceItems(scenario, shell)
  const stress = scenario === 'stress'
  const executed = !['needs-review', 'stale', 'denied'].includes(issue.state)
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    createdAt: issue.createdAt,
    state: issue.state,
    description: issue.description,
    workspace,
    referenceTime: FIXTURE_NOW,
    outcomes: outcomes(issue, shell.id),
    document: {
      title: stress ? UNBROKEN : 'Access request runbook',
      provider: { id: 'notion', name: 'Notion' },
      section: 'Escalation',
      context:
        'Requests that are not approved within two working days move to the next step. The agent records each move in the ticket history.',
      lines: [
        {
          id: 'l1',
          change: 'context',
          text: 'Every access request names the system and the reason for access.',
        },
        {
          id: 'l2',
          change: 'removed',
          text: 'After two days without a decision, escalate the request to the global queue.',
        },
        {
          id: 'l3',
          change: 'added',
          text: 'After two days without a decision, send the request to the regional owner for the requester’s office.',
        },
        {
          id: 'l4',
          change: 'added',
          text: stress
            ? `${LONG_SENTENCE} ${UNBROKEN}`
            : 'Escalate to the global queue only if the regional owner has not replied within four working hours.',
        },
        {
          id: 'l5',
          change: 'context',
          text: 'Urgent requests during an incident follow the incident runbook instead.',
        },
      ],
      fromVersion: 'v12',
      toVersion: 'v13',
    },
    workspaceChanges: stress
      ? [...items, ...items.map((item) => ({ ...item, id: `${item.id}-copy` }))]
      : items.slice(0, 4),
    comparison: {
      title: 'Before and after',
      columns: [
        {
          label: 'Current',
          items: [
            'Waits two days, then escalates globally',
            'Global queue reassigns by hand',
            'Requester is not told who owns the request',
          ],
        },
        {
          label: 'Proposed',
          items: [
            'Waits two days, then asks the regional owner',
            'Escalates only after four more working hours',
            stress ? UNBROKEN : 'Requester sees the owner’s name in the ticket',
          ],
        },
      ],
    },
    impact: [
      'About 214 requests a month reach an owner who is already online, which removes a global reassignment step for roughly three in four escalations.',
      stress
        ? `${LONG_SENTENCE} ${LONG_SENTENCE}`
        : 'Median time to a decision should fall from 2.6 days to under one working day for regional offices.',
    ],
    excerpt: {
      title: 'Source',
      provider: { id: 'slack', name: 'Slack' },
      source: '#it-operations',
      quote:
        'The Berlin requests sat in the global queue all weekend even though Lena was on call for EMEA. Can the bot just ask her first?',
    },
    evidence: { title: 'Evidence', ...evidence(scenario) },
    steps: executed
      ? {
          title: 'Execution history',
          steps: [
            { id: 's1', description: 'Read 300 access requests from the last 30 days.' },
            { id: 's2', description: 'Matched each requester to their regional owner.' },
            {
              id: 's3',
              description: stress
                ? `${LONG_SENTENCE} ${UNBROKEN}`
                : 'Updated the access request runbook and the Account review workflow.',
            },
            ...(issue.state === 'failed'
              ? [
                  {
                    id: 's4',
                    description:
                      'Stopped: the Escalation queue table rejected 12 rows with a missing region.',
                  },
                ]
              : []),
          ],
        }
      : undefined,
    changelogEntryId: issue.state === 'merged' ? changelogEntryId(issue.number) : undefined,
    blockedBy: issue.state === 'blocked' ? { providerId: 'slack', name: 'Slack' } : undefined,
  }
}

/* Changelog */

const SUMMARIES = [
  'The agent now checks the condition before it acts, so people see fewer follow-up questions and the ticket history explains each decision.',
  'Replies cite the knowledge base article they used. When no article matches, the agent asks a person and records the gap for the knowledge team.',
  'Duplicates are linked to the original ticket and closed with a note that tells the requester which ticket to follow.',
  LONG_SENTENCE,
]

function entries(scenario: Scenario, shell: ShellWorkspace): ChangelogEntry[] {
  return mergedIssues(scenario, shell)
    .map((issue, index) => ({
      id: changelogEntryId(issue.number),
      title: issue.title,
      description:
        scenario === 'stress' && index % 5 === 1
          ? `${LONG_SENTENCE} ${UNBROKEN} ${LONG_SENTENCE}`
          : SUMMARIES[index % SUMMARIES.length],
      appliedAt: issue.resolvedAt,
      contributor: issue.approver,
      issueId: issue.id,
    }))
    .sort((left, right) => right.appliedAt - left.appliedAt)
}

export function workspaceChangelog(
  scenario: Scenario,
  shell: ShellWorkspace
): ChangelogData | null {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return null
  return {
    workspace,
    referenceTime: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW - 4 * MINUTE,
    entries: entries(scenario, shell),
  }
}

export function workspaceChangelogEntry(
  scenario: Scenario,
  shell: ShellWorkspace,
  entryId: string
): ChangelogDetail | null {
  const workspace = workspaceSummary(scenario, shell)
  const entry = entries(scenario, shell).find((item) => item.id === entryId)
  if (!workspace || !entry) return null
  const items = workspaceItems(scenario, shell)
  return {
    ...entry,
    workspace,
    referenceTime: FIXTURE_NOW,
    body: [
      scenario === 'stress'
        ? `${LONG_SENTENCE} ${UNBROKEN}`
        : 'The change applies to new requests from the moment it merged. Requests already in progress finish under the previous behavior, and their history notes which version handled them.',
    ],
    workspaceChanges: scenario === 'stress' ? items : items.slice(0, 3),
  }
}

/* Dashboard */

const PERIODS = [
  { value: '24h', label: 'Last 24 hours', scale: 1 / 7, buckets: 24, bucketMs: HOUR },
  { value: '7d', label: 'Last 7 days', scale: 1, buckets: 7, bucketMs: DAY },
  { value: '30d', label: 'Last 30 days', scale: 30 / 7, buckets: 30, bucketMs: DAY },
  { value: '90d', label: 'Last 90 days', scale: 90 / 7, buckets: 13, bucketMs: 7 * DAY },
] as const

type Period = (typeof PERIODS)[number]

const FULL_AGENTS = [
  'Ticket triage',
  'Access approvals',
  'License reconciliation',
  'Incident digest',
]
const STRESS_AGENTS = [
  UNBROKEN,
  'International customer operations escalation agent',
  'Access approvals',
  'License reconciliation',
  'Incident digest',
  'Renewal forecasting',
]

const RUNNING: StatusText = { label: 'Running', tone: 'accent' }
const PAUSED: StatusText = { label: 'Paused', tone: 'warning' }
const FAILING: StatusText = { label: 'Failing', tone: 'danger' }
const IDLE: StatusText = { label: 'Idle', tone: 'neutral' }

function bucketLabel(period: Period, index: number) {
  const at = FIXTURE_NOW - (period.buckets - 1 - index) * period.bucketMs
  if (period.bucketMs === HOUR) return `${String(new Date(at).getUTCHours()).padStart(2, '0')}:00`
  return formatCalendarDate(new Date(at).toISOString().slice(0, 10))
}

function series(random: () => number, length: number, base: number, swing = 0.35) {
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index / Math.max(1, length - 1)) * Math.PI * 2.4) * swing
    return Math.max(0, Math.round(base * (1 + wave + (random() - 0.5) * swing)))
  })
}

function single(content: DashboardContent): DashboardSection['views'] {
  return { default: content }
}

function agentTable(
  scenario: Scenario,
  agents: readonly string[],
  scale: number
): DashboardTableData {
  const stress = scenario === 'stress'
  return {
    columns: [
      { key: 'agent', label: 'Agent', kind: 'text', primary: true },
      { key: 'status', label: 'Live status', kind: 'status' },
      { key: 'requests', label: 'Requests', kind: 'number' },
      { key: 'resolved', label: 'Agent resolved', kind: 'percent' },
      { key: 'time', label: 'Avg time', kind: 'duration' },
      { key: 'cost', label: 'Cost', kind: 'currency', currency: 'USD' },
      { key: 'change', label: 'Change', kind: 'delta' },
    ],
    rows: (stress ? [...agents, ...agents.map((agent) => `${agent} (EMEA)`)] : agents).map(
      (agent, index) => ({
        id: `agent-${index}`,
        values: {
          agent,
          status: [RUNNING, RUNNING, PAUSED, FAILING, IDLE][index % 5],
          requests:
            index === 3 ? null : Math.round((stress ? 4_812_093 : 428_130) * scale) - index * 9_311,
          resolved: index === 2 ? 0 : 0.912 - index * 0.083,
          time: 134_000 - index * 21_400,
          cost:
            index === 4 ? null : Math.round((stress ? 2_904_118 : 186_204) * scale) - index * 4_102,
          change: index % 2 ? -0.124 - index * 0.011 : 0.218 - index * 0.04,
        },
      })
    ),
  }
}

function snapshot(scenario: Scenario, workspaceId: string, period: Period): DashboardRow[] {
  const random = seeded(scenario, workspaceId, 'dashboard', period.value)
  const stress = scenario === 'stress'
  const agents = stress ? STRESS_AGENTS : FULL_AGENTS
  const scale = period.scale
  const labels = Array.from({ length: period.buckets }, (_, index) => bucketLabel(period, index))
  const requestBase = (stress ? 1_840_000 : 184_000) / (period.bucketMs === HOUR ? 24 : 1)
  const trend = (base: number) =>
    series(random, labels.length, base).map((value, index) => ({ label: labels[index], value }))
  const metrics: DashboardSection = {
    id: 'overview',
    title: 'Overview',
    views: single({
      kind: 'metrics',
      metrics: [
        {
          id: 'requests',
          label: 'Requests handled',
          value: Math.round((stress ? 9_876_543_210 : 1_284_392) * scale),
          unit: { kind: 'count' },
        },
        { id: 'resolved', label: 'Resolved by agents', value: 0.784, unit: { kind: 'percent' } },
        { id: 'time', label: 'Avg handle time', value: 134_000, unit: { kind: 'duration' } },
        {
          id: 'cost',
          label: 'Agent cost',
          value: Math.round((stress ? 920_488_013 : 1_204_880) * scale),
          unit: { kind: 'currency', currency: 'USD' },
        },
      ],
    }),
  }
  const requests: DashboardSection = {
    id: 'requests',
    title: 'Requests',
    choice: {
      label: 'Agent',
      options: [
        { value: 'all', label: 'All agents' },
        ...agents.map((agent, index) => ({ value: `agent-${index}`, label: agent })),
      ],
    },
    views: Object.fromEntries([
      ['all', { kind: 'trend', points: trend(requestBase) }],
      ...agents.map((_, index) => [
        `agent-${index}`,
        { kind: 'trend', points: trend(requestBase / (index + 2)) },
      ]),
    ]),
  }
  const mix: DashboardSection = {
    id: 'mix',
    title: 'Request mix',
    choice: {
      label: 'Breakdown',
      options: [
        { value: 'channel', label: 'By channel' },
        { value: 'category', label: 'By category' },
      ],
    },
    views: {
      channel: {
        kind: 'donut',
        totalLabel: 'Requests',
        segments: stress
          ? [
              { label: 'Slack', value: Math.round(4_200_000 * scale) },
              { label: 'Email', value: Math.round(2_100_000 * scale) },
              { label: 'Portal', value: Math.round(980_000 * scale) },
              { label: UNBROKEN, value: Math.round(12_000 * scale) },
              { label: 'Phone', value: Math.round(900 * scale) },
              { label: 'API', value: Math.round(40 * scale) },
            ]
          : [
              { label: 'Slack', value: Math.round(91_400 * scale) },
              { label: 'Email', value: Math.round(52_100 * scale) },
              { label: 'Portal', value: Math.round(31_800 * scale) },
              { label: 'Phone', value: Math.round(8_700 * scale) },
            ],
      },
      category: {
        kind: 'donut',
        totalLabel: 'Requests',
        segments: [
          { label: 'Access', value: Math.round(70_200 * scale) },
          { label: 'Hardware', value: Math.round(48_300 * scale) },
          { label: 'Software', value: Math.round(39_900 * scale) },
          { label: 'Other', value: Math.round(25_600 * scale) },
        ],
      },
    },
  }
  const resolutionSeries = stress
    ? [
        'Agent resolved',
        'Human assisted',
        'Escalated',
        'Reopened',
        'Waiting on requester',
        UNBROKEN,
      ]
    : ['Agent resolved', 'Human assisted', 'Escalated']
  const columns = Math.min(labels.length, period.bucketMs === HOUR ? 12 : 13)
  const barLabels = labels.slice(-columns)
  const resolution: DashboardSection = {
    id: 'resolution',
    title: 'Resolution',
    views: single({
      kind: 'bars',
      layout: 'stacked',
      series: resolutionSeries,
      bars: barLabels.map((label) => ({
        label,
        values: resolutionSeries.map((_, layer) =>
          Math.round((requestBase / (layer + 1.4)) * (0.7 + random() * 0.6))
        ),
      })),
    }),
  }
  const groupedSeries = stress
    ? ['This period', 'Previous period', 'Target', 'EMEA', 'APAC', 'Americas']
    : ['This period', 'Previous period']
  const handleTime: DashboardSection = {
    id: 'handle-time',
    title: 'Handle time by agent',
    views: single({
      kind: 'bars',
      layout: 'grouped',
      unit: { kind: 'duration' },
      series: groupedSeries,
      bars: agents.slice(0, stress ? 6 : 4).map((agent) => ({
        label: agent,
        values: groupedSeries.map(() => between(random, 40_000, 240_000)),
      })),
    }),
  }
  const costChange: DashboardSection = {
    id: 'cost-change',
    title: 'Cost change by agent',
    views: single({
      kind: 'signed',
      unit: { kind: 'currency', currency: 'USD' },
      rows: agents.map((agent, index) => ({
        id: `agent-${index}`,
        label: agent,
        value: Math.round(
          (index % 2 ? -1 : 1) * (stress ? 1_204_880 : 18_400) * scale * (1 - index * 0.15)
        ),
      })),
    }),
  }
  const summary: DashboardSection = {
    id: 'summary',
    title: 'Summary',
    views: single({
      kind: 'text',
      paragraphs: stress
        ? [`${LONG_SENTENCE} ${UNBROKEN}`, LONG_SENTENCE, LONG_SENTENCE]
        : [
            'Agents resolved 78% of requests without a person, up from 71% last period. Access approvals carried most of the gain after the regional routing change.',
            'License reconciliation is paused while finance reviews the reclaim list. Incident digest failed twice on Slack rate limits and recovered on retry.',
          ],
    }),
  }
  const roster: DashboardSection = {
    id: 'agents',
    title: 'Agents',
    views: single({
      kind: 'roster',
      agents: agents.map((agent, index) => ({
        id: `agent-${index}`,
        name: agent,
        detail:
          index === 0 && stress
            ? `${LONG_SENTENCE} ${UNBROKEN}`
            : index % 6 === 2
              ? 'since Oct 11'
              : index % 6 === 3
                ? 'on 2 of the last 40 runs'
                : undefined,
        status: [RUNNING, RUNNING, PAUSED, FAILING, IDLE, RUNNING][index % 6],
        metadata: `${new Intl.NumberFormat('en-US').format(Math.round((12_480 - index * 2_210) * scale))} requests`,
      })),
    }),
  }
  const table: DashboardSection = {
    id: 'performance',
    title: 'Agent performance',
    choice: {
      label: 'Agents',
      options: [
        { value: 'all', label: 'All agents' },
        { value: 'live', label: 'Running only' },
      ],
    },
    views: {
      all: { kind: 'table', ...agentTable(scenario, agents, scale) },
      live: {
        kind: 'table',
        ...(() => {
          const data = agentTable(scenario, agents, scale)
          return {
            ...data,
            rows: data.rows.filter((row) => row.values.status === RUNNING),
          }
        })(),
      },
    },
  }
  const outcomes: DashboardSection = {
    id: 'outcomes',
    title: 'Business outcomes',
    views: single({
      kind: 'metrics',
      metrics: [
        {
          id: 'hours',
          label: 'Hours saved',
          value: Math.round(18_240 * scale),
          unit: { kind: 'count' },
        },
        { id: 'escalations', label: 'Missed SLAs', value: 0, unit: { kind: 'count' } },
        { id: 'csat', label: 'Requester satisfaction', value: null, unit: { kind: 'percent' } },
      ],
    }),
  }
  return [
    { id: 'overview', sections: [metrics] },
    { id: 'activity', sections: [requests, mix] },
    { id: 'throughput', sections: [resolution, handleTime] },
    { id: 'cost', sections: [costChange] },
    { id: 'narrative', sections: [summary, roster] },
    { id: 'performance', sections: [table] },
    { id: 'outcomes', sections: [outcomes] },
  ]
}

export function workspaceDashboard(
  scenario: Scenario,
  shell: ShellWorkspace
): DashboardData | null {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return null
  return {
    workspace,
    referenceTime: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW - 4 * MINUTE,
    periods: PERIODS.map(({ value, label }) => ({ value, label })),
    snapshots:
      scenario === 'empty'
        ? {}
        : Object.fromEntries(
            PERIODS.map((period) => [period.value, snapshot(scenario, shell.id, period)])
          ),
  }
}

/* Runs */

const WORKFLOWS = [
  { id: 'ticket-triage', name: 'Ticket triage' },
  { id: 'access-approval', name: 'Access request approval' },
  { id: 'license-reconciliation', name: 'Nightly license reconciliation' },
  { id: 'incident-digest', name: 'Incident digest' },
  { id: 'lead-enrichment', name: 'Lead enrichment' },
  { id: 'account-review', name: 'Account review' },
]

const STRESS_WORKFLOWS = [...WORKFLOWS, { id: 'unbroken', name: UNBROKEN }]

const TRIGGERS: readonly RunTrigger[] = [
  { label: 'Slack', providerId: 'slack' },
  { label: 'Schedule', icon: 'I046' },
  { label: 'Manual', icon: 'I074' },
  { label: 'Webhook', icon: 'I041' },
  { label: 'API', icon: 'I107' },
  { label: 'Chat', icon: 'I073' },
]

const STATUSES: readonly RunStatus[] = [
  'completed',
  'completed',
  'completed',
  'completed',
  'failed',
  'waiting',
  'cancelled',
]

function executionId(random: () => number) {
  const alphabet = '0123456789abcdef'
  return Array.from({ length: 24 }, () => alphabet[Math.floor(random() * 16)]).join('')
}

function makeRuns(scenario: Scenario, workspaceId: string, count: number, offset: number) {
  const random = seeded(scenario, workspaceId, 'runs', String(offset))
  const workflows = scenario === 'stress' ? STRESS_WORKFLOWS : WORKFLOWS
  let startedAt = FIXTURE_NOW - offset * 7 * MINUTE
  return Array.from({ length: count }, (_, index): RunSummary => {
    startedAt -= between(random, 2, scenario === 'stress' ? 40 : 90) * MINUTE
    const running = offset === 0 && index < 2
    const status = running ? 'running' : pick(random, STATUSES)
    const durationMs = running
      ? null
      : scenario === 'stress' && index % 41 === 3
        ? 26 * 3_600_000 + between(random, 0, 3_600_000)
        : between(random, 400, 64_000)
    return {
      id: executionId(random),
      workflow: pick(random, workflows),
      status,
      trigger: pick(random, TRIGGERS),
      startedAt,
      durationMs,
      cu:
        index % 11 === 5
          ? null
          : scenario === 'stress' && index % 37 === 2
            ? 1_284_392.75
            : Math.round(random() * 4_000) / 100,
    }
  })
}

export function workspaceRuns(scenario: Scenario, shell: ShellWorkspace) {
  const workspace = workspaceSummary(scenario, shell)
  if (!workspace) return null
  if (scenario === 'empty') return { workspace, referenceTime: FIXTURE_NOW, runs: [] }
  // The last few minutes' runs, which a refresh brought in, lead the rest.
  const recent = makeRuns(scenario, shell.id, 3, 0).map((run, index) => ({
    ...run,
    startedAt: FIXTURE_NOW - (index + 1) * MINUTE,
  }))
  const earlier = makeRuns(scenario, shell.id, scenario === 'stress' ? 640 : 72, 1)
  return { workspace, referenceTime: FIXTURE_NOW, runs: [...recent, ...earlier] }
}

const json = (value: unknown): TracePayload => ({
  format: 'json',
  content: JSON.stringify(value, null, 2),
})

const WITHHELD: TracePayload = {
  format: 'withheld',
  reason: 'This step’s output is hidden by the workspace’s data retention policy.',
}

function hugePayload() {
  return json({
    records: Array.from({ length: 240 }, (_, index) => ({
      id: `rec_${String(index).padStart(5, '0')}`,
      requester: `requester-${index}@example.com`,
      region: ['EMEA', 'APAC', 'AMER'][index % 3],
      summary: index === 0 ? UNBROKEN : LONG_SENTENCE,
      tags: ['access', 'priority', `owner-${index % 17}`],
    })),
  })
}

interface SpanInput extends Omit<TraceSpan, 'context' | 'children' | 'status'> {
  status?: TraceSpan['status']
  context?: TraceSpan['context']
  children?: readonly TraceSpan[]
}

function span(input: SpanInput): TraceSpan {
  return { status: 'success', context: [], ...input }
}

/** Nests a chain of workflow calls, loops and branches to the given depth, on one root clock. */
function deepChain(depth: number, start: number, duration: number, level = 0): TraceSpan {
  const kinds = ['workflow', 'loop', 'iteration', 'parallel', 'branch', 'agent'] as const
  const kind = kinds[level % kinds.length]
  const name =
    kind === 'workflow'
      ? `Nested workflow level ${level + 1}`
      : kind === 'agent'
        ? `Agent at level ${level + 1}`
        : `${kind[0].toUpperCase()}${kind.slice(1)} ${level + 1}`
  return span({
    id: `deep-${level}`,
    name: level === 3 ? UNBROKEN : name,
    kind,
    providerId: kind === 'agent' ? 'openai' : undefined,
    startMs: start,
    durationMs: duration,
    context:
      kind === 'workflow'
        ? [
            { id: 'called-by', label: 'Called by', value: `Level ${level}` },
            { id: 'version', label: 'Workflow version', value: `v${level + 3}` },
          ]
        : kind === 'loop'
          ? [
              { id: 'parent', label: 'Parent', value: `Level ${level}` },
              { id: 'iterations', label: 'Iterations', value: '1' },
            ]
          : [],
    input: level === depth - 1 ? hugePayload() : undefined,
    children:
      level < depth - 1
        ? [deepChain(depth, start + duration * 0.08, duration * 0.84, level + 1)]
        : undefined,
  })
}

function trace(run: RunSummary, scenario: Scenario): TraceSpan[] {
  const failed = run.status === 'failed'
  const total = run.durationMs ?? 18_400
  const at = (fraction: number) => Math.round(total * fraction)
  const stress = scenario === 'stress'
  const payload = runPayloads({
    runId: run.id,
    workflow: run.workflow.name,
    trigger: run.trigger.label,
    startedAt: run.startedAt,
    totalMs: total,
    failed,
  })
  const children: TraceSpan[] = [
    span({
      id: 'classify',
      name: 'Classify request',
      kind: 'agent',
      providerId: 'openai',
      startMs: 0,
      durationMs: at(0.12),
      context: [{ id: 'model', label: 'Model', value: 'gpt-5' }],
      input: json(payload.classifyInput),
      output: json(payload.classifyOutput),
      children: [
        span({
          id: 'classify-model',
          name: 'gpt-5',
          kind: 'model',
          providerId: 'openai',
          startMs: at(0.005),
          durationMs: at(0.08),
          context: [
            { id: 'tokens', label: 'Tokens', value: '1,204 in, 318 out' },
            { id: 'tries', label: 'Tries', value: '2' },
          ],
          input: json(payload.modelRequest),
          output: json(payload.modelResponse),
          notice: {
            tone: 'warning',
            title: 'Retried',
            message: 'The first attempt timed out after 30 seconds. The second attempt succeeded.',
          },
        }),
        span({
          id: 'search-knowledge',
          name: 'search_knowledge',
          kind: 'tool',
          startMs: at(0.09),
          durationMs: at(0.025),
          context: [
            { id: 'call', label: 'Call ID', value: 'call_8f2c41d07a' },
            { id: 'requested', label: 'Requested by', value: 'Classify request' },
          ],
          input: json(payload.searchInput),
          output: json(payload.searchOutput),
        }),
      ],
    }),
    span({
      id: 'enrich',
      name: 'Enrich requester',
      kind: 'parallel',
      startMs: at(0.125),
      durationMs: at(0.15),
      children: [
        span({
          id: 'branch-crm',
          name: 'Branch 1',
          kind: 'branch',
          startMs: at(0.125),
          durationMs: at(0.11),
          children: [
            span({
              id: 'salesforce',
              name: 'Look up account',
              kind: 'tool',
              providerId: 'salesforce',
              startMs: at(0.13),
              durationMs: at(0.1),
              context: [
                { id: 'call', label: 'Call ID', value: 'call_1d93be2f60' },
                { id: 'requested', label: 'Requested by', value: 'Enrich requester' },
              ],
              input: json({ sobject: 'Account', id: '0015g00000QxT3vAAF', fields: 'ALL' }),
              output: json(payload.account),
            }),
          ],
        }),
        span({
          id: 'branch-identity',
          name: 'Branch 2',
          kind: 'branch',
          startMs: at(0.125),
          durationMs: at(0.15),
          children: [
            span({
              id: 'okta',
              name: 'okta.list_groups',
              kind: 'mcp',
              startMs: at(0.13),
              durationMs: at(0.14),
              context: [
                { id: 'call', label: 'Call ID', value: 'call_77ac0e519b' },
                { id: 'requested', label: 'Requested by', value: 'Enrich requester' },
              ],
              input: json({ userId: '00u1lvogt9AcmeEU', limit: 200 }),
              output: json(payload.groups),
            }),
          ],
        }),
        span({
          id: 'branch-slack',
          name: 'Branch 3',
          kind: 'branch',
          startMs: at(0.125),
          durationMs: at(0.06),
          children: [
            span({
              id: 'slack-profile',
              name: 'Read Slack profile',
              kind: 'tool',
              providerId: 'slack',
              startMs: at(0.13),
              durationMs: at(0.05),
              output: WITHHELD,
              notice: {
                tone: 'neutral',
                title: 'Content withheld',
                message: 'This step’s output is hidden by the workspace’s data retention policy.',
              },
            }),
          ],
        }),
      ],
    }),
    span({
      id: 'devices',
      name: 'Check each device',
      kind: 'loop',
      startMs: at(0.28),
      durationMs: at(0.2),
      context: [
        { id: 'parent', label: 'Parent', value: 'Ticket triage' },
        { id: 'iterations', label: 'Iterations', value: '3' },
      ],
      children: [0, 1, 2].map((index) =>
        span({
          id: `iteration-${index}`,
          name: `Iteration ${index + 1}`,
          kind: 'iteration',
          status: index === 1 ? 'handled' : 'success',
          startMs: at(0.28 + index * 0.066),
          durationMs: at(0.064),
          children: [
            span({
              id: `device-${index}`,
              name: 'Device lookup',
              kind: 'block',
              status: index === 1 ? 'handled' : 'success',
              startMs: at(0.282 + index * 0.066),
              durationMs: at(0.06),
              input: json({
                assetTag: `ACME-LT-${4410 + index}`,
                include: ['network', 'compliance'],
              }),
              output: json(payload.device(index)),
              notice:
                index === 1
                  ? {
                      tone: 'warning',
                      title: 'Handled error',
                      message: 'The inventory API returned 503. The step used the cached record.',
                    }
                  : undefined,
            }),
          ],
        })
      ),
    }),
    span({
      id: 'approval',
      name: 'Access request approval',
      kind: 'workflow',
      startMs: at(0.48),
      durationMs: at(0.3),
      context: [
        { id: 'called-by', label: 'Called by', value: run.workflow.name },
        { id: 'version', label: 'Workflow version', value: 'v14' },
      ],
      children: [
        span({
          id: 'draft',
          name: 'Draft approval',
          kind: 'agent',
          providerId: 'anthropic',
          startMs: at(0.49),
          durationMs: at(0.2),
          context: [{ id: 'model', label: 'Model', value: 'claude-sonnet-5-5' }],
          children: [
            span({
              id: 'draft-model',
              name: 'claude-sonnet-5-5',
              kind: 'model',
              providerId: 'anthropic',
              startMs: at(0.495),
              durationMs: at(0.12),
              context: [{ id: 'tokens', label: 'Tokens', value: '862 in, 74 out' }],
              input: json(payload.approvalRequest),
              output: json(payload.approvalResponse),
            }),
            span({
              id: 'policy',
              name: 'policies.lookup',
              kind: 'mcp',
              startMs: at(0.62),
              durationMs: at(0.06),
              context: [
                { id: 'call', label: 'Call ID', value: 'call_c10f4a92e3' },
                { id: 'requested', label: 'Requested by', value: 'Draft approval' },
              ],
              input: json({ policy: 'network-access', resource: 'ACME-Corp' }),
              output: json(payload.policy),
            }),
          ],
        }),
        span({
          id: 'notify',
          name: 'Notify approver',
          kind: 'tool',
          providerId: 'slack',
          startMs: at(0.7),
          durationMs: at(0.07),
          output: WITHHELD,
        }),
      ],
    }),
    span({
      id: 'summary',
      name: 'Write summary',
      kind: 'agent',
      providerId: 'openai',
      status: failed ? 'error' : 'success',
      startMs: at(0.79),
      durationMs: at(0.21),
      input: json(payload.summaryInput),
      output: failed
        ? { format: 'text', content: 'Error: the model returned an empty response twice.' }
        : {
            format: 'text',
            content:
              'Reinstalled the office Wi-Fi certificate on the requester’s laptop and confirmed the device joined the network.',
          },
      notice: failed
        ? {
            tone: 'danger',
            title: 'Step failed',
            message: 'The model returned an empty response twice. The run stopped here.',
          }
        : undefined,
    }),
  ]
  if (stress) children.push(deepChain(12, at(0.02), at(0.96)))
  return [
    span({
      id: 'root',
      name: run.workflow.name,
      kind: 'workflow',
      status: failed ? 'error' : run.status === 'running' ? 'running' : 'success',
      startMs: 0,
      durationMs: total,
      input: json(payload.trigger),
      output: failed ? undefined : json(payload.result),
      children,
    }),
  ]
}

export function workspaceRun(
  scenario: Scenario,
  shell: ShellWorkspace,
  runId: string
): RunDetail | null {
  const data = workspaceRuns(scenario, shell)
  const run = data?.runs.find((item) => item.id === runId)
  if (!data || !run) return null
  return {
    ...run,
    workspace: data.workspace,
    referenceTime: FIXTURE_NOW,
    version: scenario === 'stress' ? `v1284 ${UNBROKEN}` : 'v14',
    trace: trace(run, scenario),
  }
}
