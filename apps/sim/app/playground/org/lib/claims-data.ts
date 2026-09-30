import type { ChangelogEntry, DraftRelease } from '@/app/playground/org/lib/changelog-data'
import type {
  Chat,
  Issue,
  PlanStep,
  Release,
  Report,
  TriageProposal,
} from '@/app/playground/org/lib/mock-data'

/**
 * Overlay pack for a payment-variance investigation agent: it queries a data warehouse for
 * payment exceptions and provider-service backlog, drafts investigation briefs, and routes
 * cases to an analyst for approval.
 */

const WORKFLOWS = {
  investigation: 'Payment Exception Investigation',
  recovery: 'Provider Service Recovery',
  review: 'Analyst Review - Demo Cases',
} as const

const OWNERS = {
  teddy: { id: 'teddy', name: 'Teddy Li' },
  ava: { id: 'ava', name: 'Ava Chen' },
  marcus: { id: 'marcus', name: 'Marcus Reid' },
  priya: { id: 'priya', name: 'Priya Shah' },
} as const

const slack = (author: string, text: string, at: string): Report => ({
  source: 'slack',
  channel: '#claims-analysts',
  author,
  text,
  at,
})

const done = (label: string): PlanStep => ({ label, status: 'completed' })
const doing = (label: string): PlanStep => ({ label, status: 'inProgress' })
const todo = (label: string): PlanStep => ({ label, status: 'pending' })

export const CLAIMS_CHATS: Chat[] = [
  {
    id: 'c20',
    age: '4m',
    title: 'Why does Analyst Review reject “escalate”?',
    workspaceId: 'claims',
    owner: OWNERS.marcus.name,
  },
  {
    id: 'c21',
    age: '25m',
    title: 'Name the variance driver in every brief',
    workspaceId: 'claims',
    owner: OWNERS.ava.name,
  },
  {
    id: 'c22',
    age: '1h',
    title: 'Flag provider backlog before it breaches SLA',
    workspaceId: 'claims',
    owner: OWNERS.priya.name,
  },
  {
    id: 'c23',
    age: '2d',
    title: 'Cite the SQL behind each number',
    workspaceId: 'claims',
    owner: OWNERS.teddy.name,
  },
]

export const CLAIMS_RELEASES: Release[] = [
  {
    id: 'r-claims-inv-v2',
    workspaceId: 'claims',
    name: 'Payment Exception Investigation v2',
    date: 'Sep 26',
    notes: 'Briefs cite the SQL behind each number; warehouse queries no longer time out.',
    notified: 3,
  },
  {
    id: 'r-claims-rec-v1',
    workspaceId: 'claims',
    name: 'Provider Service Recovery v1',
    date: 'Sep 19',
    notes: 'Nightly backlog recovery run with a per-payer exception threshold.',
    notified: 2,
  },
]

export const CLAIMS_TRIAGE: TriageProposal[] = [
  {
    id: 't20',
    workspaceId: 'claims',
    title: 'Briefs list a claim twice when it has two payers',
    summary:
      'Secondary-payer claims join once per payer row. Reproduced on the Sep 27 brief: 14 of 212 lines are duplicates.',
    reports: [
      slack('Dana (analyst)', 'the brief counted claim 88-1042 twice again', '1h ago'),
      slack('Rob (analyst)', 'duplicate lines on secondary payer claims', '3h ago'),
    ],
    suggestion: { kind: 'new' },
    at: '1h ago',
  },
  {
    id: 't21',
    workspaceId: 'claims',
    title: 'Recovery run skipped the west region last night',
    summary: 'Same symptom as PAY-208: the region loop stops when a region returns zero backlog.',
    reports: [slack('Dana (analyst)', 'no west region cases in this morning’s brief', '4h ago')],
    suggestion: { kind: 'duplicate', key: 'PAY-208', confidence: 76 },
    at: '4h ago',
  },
]

export const CLAIMS_ISSUES: Issue[] = [
  {
    key: 'PAY-212',
    workspaceId: 'claims',
    title: 'Analyst Review fails on decisions other than approve or close',
    status: 'blocked',
    priority: 1,
    owner: OWNERS.marcus,
    delegate: { kind: 'workflow', name: WORKFLOWS.review },
    agent: { state: 'error', label: 'Failed 3× · invalid decision' },
    project: 'Case review',
    labels: ['bug'],
    description:
      'Analysts type “escalate” or “needs data” in the review form. The workflow only handles approve and close, so the run fails and the case stays open.',
    research: {
      cause: 'The decision switch has two branches; every other value falls through to an error.',
      related: ['PAY-197', 'run 4c1e…'],
    },
    reports: [
      slack('Dana (analyst)', 'my escalate decision errored out three times', '2h ago'),
      slack('Rob (analyst)', 'review form fails unless I pick approve', '1d ago'),
    ],
    plan: [
      done('Reproduce with a “needs data” decision'),
      { label: 'Add escalate and needs-data branches', status: 'pending' },
      todo('Reject anything else with a reason'),
    ],
    activity: [
      { kind: 'action', text: 'Reproduced with decision = escalate on case 88-1042', at: '1h ago' },
      {
        kind: 'error',
        text: 'Run failed: invalid decision "escalate" — waiting for the allowed list',
        at: '40m ago',
      },
    ],
    resources: [{ kind: 'workflow', name: WORKFLOWS.review }],
    linked: [
      {
        system: 'jira',
        key: 'CLM-1042',
        title: 'Review decisions beyond approve/close',
        status: 'In Progress',
      },
    ],
  },
  {
    key: 'PAY-208',
    workspaceId: 'claims',
    title: 'Flag provider backlog older than 14 days before it breaches SLA',
    status: 'in_progress',
    priority: 2,
    owner: OWNERS.priya,
    delegate: { kind: 'workflow', name: WORKFLOWS.recovery },
    agent: { state: 'active', label: 'Scanning region 3/7' },
    project: 'Backlog recovery',
    labels: ['agent'],
    due: 'Oct 2',
    description:
      'Score every open provider-service case by age and payer, and put anything older than 14 days at the top of the nightly recovery brief.',
    reports: [
      slack('Dana (analyst)', 'we found out about the SLA breach from the payer', '2d ago'),
    ],
    plan: [
      done('Pull open cases by region from the warehouse'),
      doing('Score each case by age and payer'),
      todo('Write the flagged cases into the recovery brief'),
      todo('Post the top 20 to #claims-analysts'),
    ],
    activity: [
      { kind: 'action', text: 'Queried open cases — 1,284 rows across 7 regions', at: '9m ago' },
      {
        kind: 'thought',
        text: 'The west region returned zero rows; checking whether the loop stops early.',
        at: '5m ago',
      },
      { kind: 'action', text: 'Scoring region 3/7…', at: 'now' },
    ],
    resources: [{ kind: 'workflow', name: WORKFLOWS.recovery }],
  },
  {
    key: 'PAY-215',
    workspaceId: 'claims',
    title: 'Name the top variance driver in every brief',
    status: 'in_progress',
    priority: 3,
    owner: OWNERS.ava,
    delegate: { kind: 'sim', name: 'Sim' },
    agent: { state: 'awaitingInput', label: 'Needs your approval' },
    project: 'Brief quality',
    labels: [],
    description:
      'Each investigation brief should open with the single biggest driver of the variance (payer, procedure, or provider) and the share it explains.',
    reports: [
      slack('Rob (analyst)', 'I read the whole brief to find out it was one payer', '3d ago'),
    ],
    plan: [
      done('Rank drivers by explained variance'),
      doing('Draft the opening sentence'),
      todo('Update the investigation playbook'),
    ],
    activity: [
      {
        kind: 'response',
        text: 'Drafted the opening line on 5 briefs. Two briefs have a tie between payer and procedure — which should lead?',
        at: '25m ago',
      },
      {
        kind: 'elicitation',
        text: 'When two drivers tie, lead with the payer or the procedure?',
        at: '25m ago',
      },
    ],
    resources: [
      { kind: 'workflow', name: WORKFLOWS.investigation },
      { kind: 'file', name: 'Payment variance playbook' },
    ],
  },
  {
    key: 'PAY-219',
    workspaceId: 'claims',
    title: 'Weekly digest of open cases to the analyst channel',
    status: 'todo',
    priority: 3,
    owner: OWNERS.teddy,
    labels: [],
    description: 'Every Monday, post the open cases by age with the analyst who owns each one.',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'PAY-221',
    workspaceId: 'claims',
    title: 'Add denial-code lookups as a second warehouse space',
    status: 'backlog',
    priority: 4,
    owner: OWNERS.marcus,
    labels: ['feature request'],
    description:
      'Briefs should explain denial codes in plain language from the payer reference tables.',
    reports: [
      slack('Dana (analyst)', 'would love the denial code spelled out in the brief', '1w ago'),
    ],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'PAY-197',
    workspaceId: 'claims',
    title: 'Briefs cite the SQL behind each number',
    status: 'done',
    priority: 2,
    owner: OWNERS.teddy,
    delegate: { kind: 'agent', name: WORKFLOWS.investigation },
    agent: { state: 'complete', label: 'Shipped' },
    project: 'Brief quality',
    labels: [],
    description:
      'Analysts sent briefs back because they could not see where a number came from. Every figure now links to the query that produced it.',
    research: {
      cause: 'The brief template dropped the query text after the LLM summarised it.',
      related: ['run 9a2f…'],
    },
    reports: [slack('Rob (analyst)', 'where does the 12% come from?', '9d ago')],
    plan: [
      done('Keep the query with each figure'),
      done('Render the query as a footnote'),
      done('Deploy'),
    ],
    activity: [
      {
        kind: 'response',
        text: 'Shipped in Payment Exception Investigation v2. Replied to 2 reporters.',
        at: 'Sep 26',
      },
    ],
    releaseId: 'r-claims-inv-v2',
    resources: [{ kind: 'workflow', name: WORKFLOWS.investigation }],
  },
  {
    key: 'PAY-201',
    workspaceId: 'claims',
    title: 'Warehouse queries time out on the claims fact table',
    status: 'done',
    priority: 1,
    owner: OWNERS.marcus,
    delegate: { kind: 'workflow', name: WORKFLOWS.investigation },
    labels: ['bug'],
    description: '',
    reports: [slack('Dana (analyst)', 'brief never arrived this morning', '8d ago')],
    plan: [],
    activity: [],
    releaseId: 'r-claims-inv-v2',
    resources: [],
  },
  {
    key: 'PAY-190',
    workspaceId: 'claims',
    title: 'Payment exception threshold is configurable per payer',
    status: 'done',
    priority: 3,
    owner: OWNERS.priya,
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    releaseId: 'r-claims-rec-v1',
    resources: [],
  },
]

export const CLAIMS_DRAFT: DraftRelease = {
  workspaceId: 'claims',
  versions: [
    { workflow: WORKFLOWS.review, from: 'v1', to: 'v2' },
    { workflow: WORKFLOWS.investigation, from: 'v2', to: 'v3' },
  ],
  changes: [
    {
      text: 'Escalate and needs-data are valid review decisions; anything else is rejected with a reason',
      issues: ['PAY-212'],
      chat: { id: 'c20', owner: OWNERS.marcus.name },
      workflow: WORKFLOWS.review,
      state: 'approval',
    },
    {
      text: 'Every brief opens with the top variance driver and the share it explains',
      issues: ['PAY-215'],
      chat: { id: 'c21', owner: OWNERS.ava.name },
      workflow: WORKFLOWS.investigation,
      state: 'ready',
    },
    {
      text: 'Secondary-payer claims appear once in the brief',
      issues: ['PAY-215'],
      chat: { id: 'c21', owner: OWNERS.ava.name },
      workflow: WORKFLOWS.investigation,
      state: 'ready',
    },
  ],
  running: [
    {
      issue: 'PAY-208',
      agent: WORKFLOWS.recovery,
      task: 'Flagging provider backlog older than 14 days',
      step: 'Scoring open cases in region 3 of 7',
      narration: [
        'I pulled 1,284 open provider-service cases across 7 regions from the warehouse.',
        'The west region returned zero rows, which looks like the loop stopping early rather than an empty backlog.',
        'I’ll re-run the west region on its own before scoring, so the brief does not miss it again.',
      ],
      progress: 0.4,
      startedMinutesAgo: 9,
      chat: { id: 'c22', owner: OWNERS.priya.name },
    },
    {
      issue: 'PAY-215',
      agent: 'Sim',
      task: 'Drafting the opening line for each brief',
      step: 'Ranking drivers on the 5 open briefs',
      narration: [
        'I ranked payer, procedure and provider by the variance each explains on the 5 open briefs.',
        'Three briefs have one clear driver; two are a tie between a payer and a procedure.',
        'I’ve asked Ava which should lead when they tie, then I’ll update the playbook.',
      ],
      progress: 0.7,
      startedMinutesAgo: 25,
      chat: { id: 'c21', owner: OWNERS.ava.name },
    },
  ],
  chart: {
    title: 'Cases sent back by analysts',
    kind: 'bar',
    values: [9, 8, 11, 7, 10, 9, 8, 6, 5, 6, 4, 3, 3, 2],
    releaseIndex: 14,
  },
  marker: 'v3',
  release: {
    title: 'Review decisions and clearer briefs',
    summary:
      'Analysts can escalate or ask for data from the review form, and every brief leads with the driver that explains the variance.',
    reporters: ['Dana (analyst)', 'Rob (analyst)'],
    channel: '#claims-analysts',
  },
}

export const CLAIMS_CHANGELOG: ChangelogEntry[] = [
  {
    id: 'claims-inv-v2',
    workspaceId: 'claims',
    date: 'Sep 26',
    version: 'v2',
    workflows: [WORKFLOWS.investigation],
    title: 'Briefs cite the SQL behind each number',
    summary:
      'Analysts were sending briefs back because a figure had no source. Every number in a brief now footnotes the warehouse query that produced it, and the claims fact table query finishes inside the timeout.',
    changes: [
      {
        text: 'Each figure keeps the query that produced it and renders it as a footnote',
        issues: ['PAY-197'],
        chat: { id: 'c23', owner: OWNERS.teddy.name },
        workflow: WORKFLOWS.investigation,
      },
      {
        text: 'Claims fact table queries filter by service month before joining payers',
        issues: ['PAY-201'],
        workflow: WORKFLOWS.investigation,
      },
    ],
    metrics: [
      {
        label: 'Briefs sent back for missing evidence',
        before: 31,
        after: 4,
        unit: '%',
        lowerIsBetter: true,
      },
      { label: 'Brief delivery time', before: 41, after: 6, unit: 'min', lowerIsBetter: true },
    ],
    chart: {
      title: 'Briefs sent back for missing evidence',
      kind: 'line',
      unit: '%',
      values: [28, 30, 33, 29, 31, 34, 30, 32, 31, 30, 5, 4, 3, 4],
      releaseIndex: 10,
    },
    reporters: ['Rob (analyst)', 'Dana (analyst)'],
    channel: '#claims-analysts',
    live: { label: 'briefs since release', goodLabel: 'sent back' },
  },
  {
    id: 'claims-rec-v1',
    workspaceId: 'claims',
    date: 'Sep 19',
    version: 'v1',
    workflows: [WORKFLOWS.recovery],
    title: 'Provider backlog recovery runs nightly',
    summary:
      'Recovery cases used to be opened by hand from a weekly export. The agent now pulls the backlog every night, applies each payer’s exception threshold, and opens the cases itself.',
    changes: [
      {
        text: 'Nightly run over the provider-service backlog',
        issues: ['PAY-190'],
        workflow: WORKFLOWS.recovery,
      },
      {
        text: 'Exception threshold is read per payer from the settings table',
        issues: ['PAY-190'],
        workflow: WORKFLOWS.recovery,
      },
    ],
    metrics: [
      { label: 'Cases opened by hand each week', before: 26, after: 3, lowerIsBetter: true },
      { label: 'Days from breach to case', before: 9, after: 1, lowerIsBetter: true },
    ],
    reporters: ['Dana (analyst)'],
    channel: '#claims-analysts',
  },
]
