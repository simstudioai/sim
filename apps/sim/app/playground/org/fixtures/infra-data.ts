import type { Investigation, Issue, Release, TriageProposal } from '@/app/playground/org/lib/types'

const MARCUS = { id: 'marcus', name: 'Marcus Reid' }
const TEDDY = { id: 'teddy', name: 'Teddy Li' }
const PRIYA = { id: 'priya', name: 'Priya Shah' }

/** Unwanted replies per day; zero until v14 shipped on Sep 22. */
const FREQUENCY_COUNTS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 38, 52, 47, 21, 18, 61, 75,
]

function lastThirtyDays(): { date: string; count: number }[] {
  const end = Date.UTC(2026, 8, 28)
  return FREQUENCY_COUNTS.map((count, index) => ({
    date: new Date(end - (FREQUENCY_COUNTS.length - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count,
  }))
}

const CONDITION_V13 = "<slack.event.type> == 'app_mention'"
const CONDITION_V14 = "<slack.event.type> == 'app_mention' || <slack.event.thread_ts> != null"

const INF_412: Investigation = {
  workflow: { name: 'slack-support-bot', version: 'v14', nextVersion: 'v15' },
  summary: [
    {
      label: 'What',
      text: 'slack-support-bot replies to every message in a thread, even when nobody tags it.',
    },
    {
      label: 'Why',
      text: 'Version v14 changed its “Should reply?” condition so any thread message passes, not only @mentions.',
    },
    { label: 'Impact', text: '312 unwanted replies in 41 threads across 3 channels since Sep 22.' },
    {
      label: 'Fix',
      text: 'Restore the mention-only condition and redeploy as v15. Waiting for your approval.',
    },
  ],
  origin: {
    kind: 'slack',
    message: {
      author: 'Dan Ortiz',
      channel: '#bot-feedback',
      at: '09:12',
      text: 'The support bot replies on every message in a thread, even when nobody tagged it. It just jumped into 4 of our #help threads this morning 😩',
    },
    thread: [
      {
        author: 'Rae Kim',
        channel: '#bot-feedback',
        at: '09:14',
        text: '+1, it answered a thread in #eng-random where we were just chatting',
      },
      {
        author: 'Sim',
        channel: '#bot-feedback',
        at: '09:19',
        text: 'Found it — a condition change in slack-support-bot v14. I’ve proposed a fix on INF-412; it redeploys once someone approves.',
      },
    ],
  },
  sources: [
    { kind: 'slack', label: '#bot-feedback thread' },
    { kind: 'workflow', label: 'slack-support-bot' },
    { kind: 'logs', label: '200 runs since Sep 22' },
    { kind: 'history', label: 'Version history v13 → v14' },
  ],
  timeline: [
    {
      at: '09:12',
      kind: 'feedback',
      title: 'Dan reported it in #bot-feedback',
      detail:
        'Rae added a second report two minutes later. Sim picked the thread up from the feedback source.',
    },
    {
      at: '09:13',
      kind: 'workflow',
      title: 'Matched to slack-support-bot',
      detail: 'The only deployed workflow that replies in #help and #eng-random.',
    },
    {
      at: '09:14',
      kind: 'runs',
      title: 'Checked the last 200 runs in Logs',
      detail:
        '142 runs started from a plain thread message with no @mention — and the bot replied to every one.',
      evidence: {
        type: 'runs',
        title: 'Logs · slack-support-bot · most recent runs',
        columns: ['Time', 'Slack event', 'Bot mentioned', 'Replied'],
        rows: [
          ['09:11:40', 'message (thread)', 'No', 'Yes'],
          ['09:10:02', 'message (thread)', 'No', 'Yes'],
          ['09:08:55', 'app_mention', 'Yes', 'Yes'],
          ['09:06:31', 'message (thread)', 'No', 'Yes'],
          ['09:04:12', 'message (thread)', 'No', 'Yes'],
          ['08:59:47', 'app_mention', 'Yes', 'Yes'],
        ],
        flagged: [0, 1, 3, 4],
      },
    },
    {
      at: '09:15',
      kind: 'run',
      title: 'Opened a run that should not have replied',
      detail: 'The “Should reply?” condition returned true for a thread message with no mention.',
      evidence: {
        type: 'run',
        runId: 'run_8c1e40',
        summary: 'message in #help thread · 4.2s · no mention',
        blocks: [
          {
            id: 'b1',
            name: 'Slack trigger',
            type: 'trigger',
            start: 0,
            duration: 40,
            depth: 0,
            output: "event.type = 'message', thread_ts = 1790… ",
          },
          {
            id: 'b2',
            name: 'Should reply?',
            type: 'condition',
            start: 40,
            duration: 6,
            depth: 0,
            output: 'true → reply branch',
            highlight: true,
          },
          {
            id: 'b3',
            name: 'Search knowledge',
            type: 'knowledge',
            start: 46,
            duration: 610,
            depth: 1,
            output: '5 chunks · Product docs',
          },
          {
            id: 'b4',
            name: 'Support agent',
            type: 'agent',
            start: 656,
            duration: 3280,
            depth: 1,
            output: '212 tokens',
          },
          {
            id: 'b5',
            name: 'Reply in thread',
            type: 'slack',
            start: 3936,
            duration: 280,
            depth: 1,
            output: 'posted to #help',
          },
        ],
      },
    },
    {
      at: '09:16',
      kind: 'config',
      title: 'Read the “Should reply?” condition',
      detail:
        'It passes on an @mention OR on any message that has a thread — so every thread reply qualifies.',
      evidence: {
        type: 'diff',
        title: 'Should reply? · Condition block',
        subtitle: 'slack-support-bot v14 (live)',
        lines: [{ kind: 'ctx', text: `if ${CONDITION_V14}` }],
      },
    },
    {
      at: '09:17',
      kind: 'history',
      title: 'Found the change in version history',
      detail:
        'Ava edited the condition in v14 on Sep 22 to keep follow-up questions going. Unwanted replies start that day.',
      evidence: {
        type: 'diff',
        title: 'Should reply? · v13 → v14',
        subtitle: 'Deployed Sep 22 by Ava Chen',
        lines: [
          { kind: 'del', text: `if ${CONDITION_V13}` },
          { kind: 'add', text: `if ${CONDITION_V14}` },
        ],
      },
    },
    {
      at: '09:18',
      kind: 'conclusion',
      title: 'Root cause confirmed — stopped for approval',
      detail: 'Sim will not change or redeploy the workflow until someone approves.',
    },
  ],
  rootCause: {
    summary:
      'In v14 the “Should reply?” condition gained an OR clause that lets any message inside a thread through. The bot is subscribed to all channel messages, so once it is in a thread it answers everything posted there, tagged or not.',
    chain: [
      'The Slack trigger receives every message in channels the bot is in',
      '“Should reply?” passes if the bot is mentioned OR the message is in a thread',
      'Any reply in any thread matches the second half',
      'The support agent runs and posts an answer to the thread',
    ],
    confidence: 'High',
    confidenceReason:
      '142 of 142 unmentioned thread messages got a reply; none did before v14; replaying them against v13 produces zero replies.',
    block: {
      path: 'slack-support-bot › Should reply? (Condition)',
      lines: [
        `if ${CONDITION_V14}`,
        '  → Search knowledge → Support agent → Reply in thread',
        'else',
        '  → end',
      ],
    },
  },
  frequency: {
    query:
      'Logs · slack-support-bot runs where the event is a thread message, the bot was not mentioned, and a reply was sent',
    days: lastThirtyDays(),
    stats: [
      { label: 'First seen', value: 'Sep 22 · after v14' },
      { label: 'Unwanted replies', value: '312' },
      { label: 'Threads affected', value: '41' },
      { label: 'Channels', value: '#help, #eng-random, #sales' },
    ],
  },
  proposal: {
    summary: 'Restore the mention-only condition, then redeploy the workflow.',
    diff: [
      { kind: 'del', text: `if ${CONDITION_V14}` },
      { kind: 'add', text: `if ${CONDITION_V13}` },
    ],
    tradeoff: 'Follow-up questions in a thread will need to tag @Sim again, like before v14.',
    replay:
      'Replayed the last 200 runs against the change: 0 unwanted replies, all 58 @mentions still answered.',
  },
}

function stub(
  key: string,
  title: string,
  status: Issue['status'],
  owner: { id: string; name: string },
  extra: Partial<Issue> = {}
): Issue {
  return {
    key,
    workspaceId: 'infra',
    title,
    status,
    priority: 3,
    owner,
    project: 'Slack support bot',
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
    ...extra,
  }
}

const AVA = { id: 'ava', name: 'Ava Chen' }

export const INFRA_ISSUES: Issue[] = [
  stub('INF-415', 'Bot jumped into a #sales thread nobody asked it in', 'in_progress', MARCUS, {
    agent: { state: 'complete', label: 'Merged into INF-412' },
    delegate: { kind: 'agent', name: 'infra-analyzer' },
  }),
  stub('INF-417', 'Edited messages trigger a second answer', 'in_progress', AVA, {
    agent: { state: 'complete', label: 'Fix ready for release' },
    delegate: { kind: 'sim', name: 'Sim' },
  }),
  stub('INF-418', 'Refund answers still hedge on the 30-day window', 'in_progress', AVA, {
    agent: { state: 'active', label: 'Drafting refund answers' },
    delegate: { kind: 'sim', name: 'Sim' },
  }),
  stub('INF-420', 'Follow-up rule might answer side conversations', 'in_progress', MARCUS, {
    agent: { state: 'active', label: 'Replaying 200 runs' },
    delegate: { kind: 'agent', name: 'infra-analyzer' },
  }),
  stub('INF-421', 'Digest should show how long each investigation took', 'in_progress', PRIYA, {
    project: 'Digests',
    agent: { state: 'complete', label: 'Fix ready for release' },
    delegate: { kind: 'sim', name: 'Sim' },
  }),
  stub('INF-411', 'Knowledge base went stale without anyone noticing', 'done', PRIYA, {
    releaseId: 'r-kb',
  }),
  stub('INF-399', 'Top-level questions got answered in-channel', 'done', TEDDY, {
    releaseId: 'r-bot-v13',
  }),
  stub('INF-393', 'Digest groups items by time, hard to scan', 'done', PRIYA, {
    project: 'Digests',
    releaseId: 'r-digest-v2',
  }),
  {
    key: 'INF-412',
    workspaceId: 'infra',
    title: 'Support bot replies to every thread message, even when not tagged',
    status: 'in_progress',
    priority: 1,
    owner: MARCUS,
    delegate: { kind: 'agent', name: 'infra-analyzer' },
    agent: { state: 'awaitingInput', label: 'Needs approval' },
    project: 'Slack support bot',
    labels: ['feedback'],
    description: '',
    reports: [
      {
        source: 'slack',
        channel: '#bot-feedback',
        author: 'Dan Ortiz',
        text: 'replies on every message in a thread',
        at: '09:12',
      },
      {
        source: 'slack',
        channel: '#bot-feedback',
        author: 'Rae Kim',
        text: 'answered a thread in #eng-random',
        at: '09:14',
      },
    ],
    plan: [],
    activity: [],
    resources: [
      { kind: 'workflow', name: 'slack-support-bot' },
      { kind: 'knowledge', name: 'Product docs' },
      { kind: 'dashboard', name: 'Infra analyzer' },
    ],
    investigation: INF_412,
    linked: [
      {
        system: 'linear',
        key: 'BOT-118',
        title: 'Bot replies in threads without being tagged',
        status: 'In Progress',
      },
      {
        system: 'linear',
        key: 'BOT-121',
        title: 'Bot joined a #sales thread uninvited',
        status: 'Duplicate',
      },
      {
        system: 'jira',
        key: 'CS-4410',
        title: 'Customer escalation: support bot spamming #help',
        status: 'Waiting on eng',
      },
    ],
  },
  {
    key: 'INF-409',
    workspaceId: 'infra',
    title: 'incident-digest skipped Friday’s scheduled run',
    status: 'in_progress',
    priority: 2,
    owner: TEDDY,
    delegate: { kind: 'agent', name: 'infra-analyzer' },
    agent: { state: 'active', label: 'Reading schedule runs' },
    project: 'Digests',
    labels: ['feedback'],
    description: 'Reported in #bot-feedback: no digest arrived on Friday.',
    reports: [],
    plan: [],
    activity: [
      { kind: 'action', text: 'Pulled schedule history for incident-digest', at: '6m ago' },
      { kind: 'action', text: 'Checking the Friday run’s trigger…', at: 'now' },
    ],
    resources: [],
  },
  {
    key: 'INF-406',
    workspaceId: 'infra',
    title: 'Bot quoted the old refund policy',
    status: 'done',
    priority: 3,
    owner: PRIYA,
    delegate: { kind: 'agent', name: 'infra-analyzer' },
    agent: { state: 'complete', label: 'Knowledge base re-synced' },
    project: 'Slack support bot',
    labels: [],
    description:
      'Product docs connector had not synced since Sep 3. Re-synced; the answer now cites the current policy.',
    releaseId: 'r-kb',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'INF-401',
    workspaceId: 'infra',
    title: 'Let the bot follow up in threads it was tagged in',
    status: 'todo',
    priority: 3,
    owner: MARCUS,
    project: 'Slack support bot',
    labels: ['feature request'],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    resources: [],
  },
  {
    key: 'INF-398',
    workspaceId: 'infra',
    title: 'Bot answers in the thread instead of the channel',
    status: 'done',
    priority: 2,
    owner: TEDDY,
    delegate: { kind: 'agent', name: 'infra-analyzer' },
    project: 'Slack support bot',
    labels: [],
    description: '',
    reports: [
      {
        source: 'slack',
        channel: '#bot-feedback',
        author: 'Sam Lee',
        text: 'bot replies land in the channel, not the thread',
        at: 'Sep 19',
      },
    ],
    plan: [],
    activity: [],
    releaseId: 'r-bot-v13',
    resources: [],
  },
  {
    key: 'INF-395',
    workspaceId: 'infra',
    title: 'Digest includes run links',
    status: 'done',
    priority: 3,
    owner: PRIYA,
    project: 'Digests',
    labels: [],
    description: '',
    reports: [],
    plan: [],
    activity: [],
    releaseId: 'r-digest-v2',
    resources: [],
  },
]

export const INFRA_TRIAGE: TriageProposal[] = [
  {
    id: 'ti1',
    workspaceId: 'infra',
    title: 'Bot jumped into a #sales thread nobody asked it in',
    summary: 'Same pattern as INF-412: an unmentioned thread message, and the bot replied.',
    reports: [
      {
        source: 'slack',
        channel: '#bot-feedback',
        author: 'Jess Park',
        text: 'why is the bot answering our deal thread lol',
        at: '10:02',
      },
    ],
    suggestion: { kind: 'duplicate', key: 'INF-412', confidence: 96 },
    at: '10:02',
  },
  {
    id: 'ti2',
    workspaceId: 'infra',
    title: 'Answers take 20+ seconds in the afternoon',
    summary:
      'slack-support-bot runs slow between 2 and 5pm. The Support agent block waits on model rate limits. No matching issue yet.',
    reports: [
      {
        source: 'slack',
        channel: '#bot-feedback',
        author: 'Ava Chen',
        text: 'bot is super slow after lunch',
        at: '11:20',
      },
      {
        source: 'slack',
        channel: '#help',
        author: 'Dan Ortiz',
        text: 'is the bot down? waited forever',
        at: '15:48',
      },
    ],
    suggestion: { kind: 'new' },
    at: '11:20',
  },
]

export const INFRA_RELEASES: Release[] = [
  {
    id: 'r-kb',
    workspaceId: 'infra',
    name: 'Product docs re-sync',
    date: 'Sep 26',
    notes: 'Answers cite the current refund policy; knowledge bases sync nightly.',
    notified: 1,
  },
  {
    id: 'r-bot-v13',
    workspaceId: 'infra',
    name: 'slack-support-bot v13',
    date: 'Sep 20',
    notes: 'Replies stay in the thread they were asked in.',
    notified: 1,
  },
  {
    id: 'r-digest-v2',
    workspaceId: 'infra',
    name: 'incident-digest v2',
    date: 'Sep 15',
    notes: 'Each digest item links to its run.',
    notified: 0,
  },
]
