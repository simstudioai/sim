import type { Investigation } from '@/app/playground/org/lib/infra-data'
import type { Issue } from '@/app/playground/org/lib/mock-data'

const AVA = { id: 'ava', name: 'Ava Chen' }

/** Contradicting answers per day; zero until the Sep 26 re-sync added the 2026 policy. */
const CONTRADICTIONS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 6, 5, 8,
]

function lastThirtyDays(): { date: string; count: number }[] {
  const end = Date.UTC(2026, 8, 28)
  return CONTRADICTIONS.map((count, index) => ({
    date: new Date(end - (CONTRADICTIONS.length - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count,
  }))
}

const OLD_POLICY = 'Refunds are available within 14 days of purchase.'
const NEW_POLICY = 'Annual plans can be refunded within 30 days; monthly plans are not refunded.'

const SUP_153: Investigation = {
  workflow: { name: 'support-agent', version: 'v14', nextVersion: 'v15' },
  summary: [
    {
      label: 'What',
      text: 'The knowledge check asked Billing policies for the refund window and got 14 days and 30 days.',
    },
    {
      label: 'Why',
      text: 'Two Confluence pages are indexed: the 2024 policy was never archived when the 2026 one was published.',
    },
    {
      label: 'Impact',
      text: '23 answers quoted the old 14-day window since Sep 26; 2 customers escalated.',
    },
    {
      label: 'Fix',
      text: 'Archive the 2024 policy and filter search to current documents, then redeploy.',
    },
  ],
  origin: {
    kind: 'kbQuery',
    knowledgeBase: 'Billing policies',
    query: 'What is the refund window?',
    at: '10:41',
    detail:
      'Sim’s nightly knowledge check asks each knowledge base its most common questions and compares the answers. This one came back two ways.',
    answers: [
      {
        answer: 'Refunds are available within 14 days of purchase.',
        cites: 'Refund policy (2024)',
      },
      {
        answer: 'Annual plans can be refunded within 30 days; monthly plans are not refunded.',
        cites: 'Refund policy (2026)',
      },
    ],
  },
  documents: [
    {
      system: 'confluence',
      title: 'Refund policy (2024)',
      space: 'Billing › Policies',
      author: 'Priya Shah',
      updated: 'Mar 4, 2024',
      excerpt: [
        'Customers may request a refund for any plan.',
        OLD_POLICY,
        'Refunds are issued to the original payment method within 5–7 business days.',
      ],
      highlight: OLD_POLICY,
    },
    {
      system: 'confluence',
      title: 'Refund policy (2026)',
      space: 'Billing › Policies',
      author: 'Ava Chen',
      updated: 'Sep 24, 2026',
      excerpt: [
        'This policy replaces all earlier refund policies.',
        NEW_POLICY,
        'Refunds are issued to the original payment method within 5–7 business days.',
      ],
      highlight: NEW_POLICY,
    },
  ],
  sources: [
    { kind: 'workflow', label: 'Knowledge check · Billing policies' },
    { kind: 'workflow', label: 'Confluence · Refund policy (2024)' },
    { kind: 'workflow', label: 'Confluence · Refund policy (2026)' },
    { kind: 'logs', label: '48 refund questions since Sep 26' },
    { kind: 'history', label: 'Confluence connector sync history' },
  ],
  timeline: [
    {
      at: '10:41',
      kind: 'check',
      title: 'Knowledge check got two answers to one question',
      detail: '“What is the refund window?” returned 14 days and 30 days from Billing policies.',
    },
    {
      at: '10:43',
      kind: 'runs',
      title: 'Checked every refund question since Sep 26',
      detail: '48 runs: 25 answered 30 days, 23 answered 14 days, for the same kind of question.',
      evidence: {
        type: 'runs',
        title: 'Logs · support-agent · refund questions',
        columns: ['Time', 'Question', 'Answer', 'Cited'],
        rows: [
          ['10:39', 'what’s the refund window?', '14 days', 'Refund policy (2024)'],
          ['10:36', 'can I get a refund on annual?', '30 days', 'Refund policy (2026)'],
          ['10:12', 'refund period?', '14 days', 'Refund policy (2024)'],
          ['09:55', 'how long do I have to request a refund', '30 days', 'Refund policy (2026)'],
        ],
        flagged: [0, 2],
      },
    },
    {
      at: '10:45',
      kind: 'run',
      title: 'Opened a run that quoted 14 days',
      detail:
        'Search knowledge returned chunks from both policies; the agent used the higher-ranked old one.',
      evidence: {
        type: 'run',
        runId: 'run_4b90d2',
        summary: 'refund question in #help · 3.1s',
        blocks: [
          {
            id: 'b1',
            name: 'Slack trigger',
            type: 'trigger',
            start: 0,
            duration: 35,
            depth: 0,
            output: 'what’s the refund window?',
          },
          {
            id: 'b2',
            name: 'Search knowledge',
            type: 'knowledge',
            start: 35,
            duration: 540,
            depth: 0,
            output: 'Refund policy (2024) 0.91 · Refund policy (2026) 0.88',
            highlight: true,
          },
          {
            id: 'b3',
            name: 'Support agent',
            type: 'agent',
            start: 575,
            duration: 2310,
            depth: 0,
            output: 'answered “14 days”',
          },
          {
            id: 'b4',
            name: 'Reply in thread',
            type: 'slack',
            start: 2885,
            duration: 220,
            depth: 0,
            output: 'posted to #help',
          },
        ],
      },
    },
    {
      at: '10:49',
      kind: 'config',
      title: 'Compared the two Confluence pages',
      detail:
        'Both are live in Billing › Policies; the 2026 page says it replaces earlier ones, but the 2024 page was never archived.',
      evidence: {
        type: 'diff',
        title: 'Refund policy · 2024 → 2026',
        subtitle: 'Billing policies knowledge base',
        lines: [
          { kind: 'del', text: OLD_POLICY },
          { kind: 'add', text: NEW_POLICY },
        ],
      },
    },
    {
      at: '10:52',
      kind: 'history',
      title: 'Found when the second policy arrived',
      detail:
        'The Sep 26 Confluence sync added the 2026 page; the 2024 page stayed in the same space.',
    },
    {
      at: '10:55',
      kind: 'conclusion',
      title: 'Root cause confirmed — stopped for approval',
      detail: 'Sim will not archive documents or redeploy until someone approves.',
    },
  ],
  rootCause: {
    summary:
      'Billing policies contains two Confluence refund policies that disagree. Search ranks them almost equally, so whichever scores slightly higher decides the answer, and the bot contradicts itself from one question to the next.',
    chain: [
      'The Sep 26 Confluence sync added “Refund policy (2026)” to Billing policies',
      '“Refund policy (2024)” stayed live; nothing marks it as replaced',
      'Refund questions match both documents with near-equal scores',
      'The agent answers from the top chunk: 14 days or 30 days',
    ],
    confidence: 'High',
    confidenceReason:
      'Every 14-day answer cited the 2024 document and every 30-day answer cited the 2026 one; none appeared before the re-sync.',
    block: {
      path: 'support-agent › Search knowledge (Billing policies)',
      lines: ['query: <slack.message.text>', 'top_k: 5', 'filter: none  ← both policies eligible'],
    },
  },
  frequency: {
    query: 'Logs · support-agent refund answers citing Refund policy (2024), since Sep 26',
    days: lastThirtyDays(),
    stats: [
      { label: 'First seen', value: 'Sep 26 · after re-sync' },
      { label: 'Contradicting answers', value: '23' },
      { label: 'Questions affected', value: 'refund window, refund eligibility' },
      { label: 'Documents', value: '2' },
    ],
  },
  proposal: {
    summary:
      'Archive “Refund policy (2024)” in Confluence and point it at the 2026 policy. The next sync drops it from Billing policies, so every answer cites the current terms.',
    diff: [],
    tradeoff:
      'Questions about orders placed before 2026 will be handed to billing instead of answered.',
    replay:
      'Replayed all 48 refund questions without the 2024 page: every answer says 30 days for annual plans.',
    docEdit: {
      system: 'confluence',
      page: 'Refund policy (2024)',
      space: 'Billing › Policies',
      lines: [
        {
          kind: 'add',
          text: 'Status: Archived — replaced by Refund policy (2026) on Sep 24, 2026.',
        },
        { kind: 'ctx', text: 'Customers may request a refund for any plan.' },
        { kind: 'del', text: OLD_POLICY },
        { kind: 'add', text: 'For current terms, see Refund policy (2026).' },
        {
          kind: 'ctx',
          text: 'Refunds are issued to the original payment method within 5–7 business days.',
        },
      ],
    },
  },
}

export const SUPPORT_ISSUES: Issue[] = [
  {
    key: 'SUP-153',
    workspaceId: 'support',
    title: 'Knowledge base gives contradictory refund answers',
    status: 'in_progress',
    priority: 2,
    owner: AVA,
    delegate: { kind: 'agent', name: 'infra-analyzer' },
    agent: { state: 'awaitingInput', label: 'Needs approval' },
    project: 'Billing deflection',
    labels: ['knowledge'],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [
      { kind: 'knowledge', name: 'Billing policies' },
      { kind: 'workflow', name: 'support-agent' },
    ],
    investigation: SUP_153,
    linked: [
      {
        system: 'linear',
        key: 'SUPT-201',
        title: 'Bot gives two different refund windows',
        status: 'In Progress',
      },
    ],
  },
]
