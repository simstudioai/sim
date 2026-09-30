import { CLAIMS_CHANGELOG, CLAIMS_DRAFT } from '@/app/playground/org/lib/claims-data'

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

export const DRAFTS: DraftRelease[] = [
  CLAIMS_DRAFT,
  {
    workspaceId: 'infra',
    versions: [
      { workflow: 'slack-support-bot', from: 'v14', to: 'v15' },
      { workflow: 'incident-digest', from: 'v2', to: 'v3' },
    ],
    changes: [
      {
        text: 'The bot only answers when you tag it',
        issues: ['INF-412', 'INF-415'],
        chat: { id: 'c6', owner: 'Marcus Reid' },
        workflow: 'slack-support-bot',
        state: 'approval',
      },
      {
        text: 'Editing a message no longer triggers a second answer',
        issues: ['INF-417'],
        chat: { id: 'c7', owner: 'Ava Chen' },
        workflow: 'slack-support-bot',
        state: 'ready',
      },
      {
        text: 'Follow-ups work in threads where you already tagged the bot',
        issues: ['INF-401', 'INF-417'],
        chat: { id: 'c7', owner: 'Ava Chen' },
        workflow: 'slack-support-bot',
        state: 'ready',
      },
      {
        text: 'Each digest item shows how long its investigation took',
        issues: ['INF-421'],
        chat: { id: 'c9', owner: 'Priya Shah' },
        workflow: 'incident-digest',
        state: 'ready',
      },
    ],
    running: [
      {
        issue: 'INF-409',
        agent: 'infra-analyzer',
        task: 'Finding out why Friday’s digest never sent',
        step: 'Reading the schedule history for incident-digest',
        narration: [
          'I pulled the schedule history for incident-digest. Friday’s 4pm run never started, and Thursday’s ran fine.',
          'The schedule was edited Friday at 3:52pm; the new cron is set to UTC, so 4pm became 9am.',
          'I’ll check whether any other schedules were saved in UTC by mistake before proposing a fix.',
        ],
        progress: 0.55,
        startedMinutesAgo: 6,
        chat: { id: 'c8', owner: 'Teddy Li' },
      },
      {
        issue: 'INF-420',
        agent: 'infra-analyzer',
        task: 'Checking the follow-up rule won’t answer side conversations',
        step: 'Replaying 200 thread messages against the new rule',
        narration: [
          'I’m replaying 200 thread messages from #help against the new follow-up rule.',
          'So far 61 of 64 follow-ups get answered and none of the side conversations do.',
          'Three misses are replies to a teammate that mention the bot’s last answer; checking whether to count those.',
        ],
        progress: 0.3,
        startedMinutesAgo: 2,
        chat: { id: 'c7', owner: 'Ava Chen' },
      },
      {
        issue: 'INF-418',
        agent: 'Sim',
        task: 'Rewriting refund answers from the current policy',
        step: 'Drafting 5 answers from Billing policies',
        narration: [
          'I’m rewriting the five refund answers from the current Billing policies doc.',
          'Two answers still said “up to 14 days”; the policy is 30 days for annual plans only.',
          'Drafting the annual vs monthly split, then I’ll ask Ava to review the wording.',
        ],
        progress: 0.7,
        startedMinutesAgo: 12,
        chat: { id: 'c10', owner: 'Ava Chen' },
      },
    ],
    chart: {
      title: 'Unwanted replies per day',
      kind: 'bar',
      values: [0, 0, 0, 0, 0, 0, 0, 38, 52, 47, 21, 18, 61, 75],
      releaseIndex: 13,
    },
    marker: 'v15 · pending',
    release: {
      title: 'Smarter thread replies and timed digests',
      summary:
        'The bot stops double-answering edited messages and keeps helping in threads you tagged it in. Digests now show how long each investigation took.',
      reporters: ['Rae Kim', 'Sam Lee'],
      channel: '#bot-feedback',
    },
  },
  {
    workspaceId: 'support',
    versions: [
      { workflow: 'ticket-router', from: 'v6', to: 'v7' },
      { workflow: 'support-agent', from: 'v14', to: 'v15' },
    ],
    changes: [
      {
        text: 'Refund answers stop contradicting each other',
        issues: ['SUP-153'],
        chat: { id: 'c15', owner: 'Ava Chen' },
        workflow: 'support-agent',
        state: 'approval',
      },
      {
        text: 'Billing macros answer the five most common refund questions',
        issues: ['SUP-140'],
        chat: { id: 'c11', owner: 'Ava Chen' },
        workflow: 'support-agent',
        state: 'approval',
      },
      {
        text: 'Billing questions reach the billing agent before anyone else',
        issues: ['SUP-137', 'SUP-129'],
        chat: { id: 'c12', owner: 'Priya Shah' },
        workflow: 'ticket-router',
        state: 'ready',
      },
      {
        text: 'Escalations arrive with a one-line reason and a suggested owner',
        issues: ['SUP-142', 'SUP-133'],
        chat: { id: 'c13', owner: 'Teddy Li' },
        workflow: 'support-agent',
        state: 'ready',
      },
      {
        text: 'Feature requests are tagged and grouped instead of answered',
        issues: ['SUP-98'],
        chat: { id: 'c13', owner: 'Teddy Li' },
        workflow: 'support-agent',
        state: 'ready',
      },
    ],
    running: [
      {
        issue: 'SUP-131',
        agent: 'churn-agent',
        task: 'Scoring every active account for churn risk',
        step: 'Scoring batch 3 of 9 (196 accounts)',
        narration: [
          'I’m scoring every account active in the last 30 days and writing results to churn_signals.',
          'Batch 3 has 214 accounts with no plan field, so each one falls back to a full usage scan.',
          'I’ll finish batch 3, then backfill plan from Stripe so the remaining batches run faster.',
        ],
        progress: 0.35,
        startedMinutesAgo: 12,
        chat: { id: 'c1', owner: 'Teddy Li' },
      },
      {
        issue: 'SUP-145',
        agent: 'Sim',
        task: 'Adding Zendesk as a feedback source',
        step: 'Mapping Zendesk statuses to Linear',
        narration: [
          'I connected Zendesk and I’m mapping its statuses to Linear.',
          '“On-hold” has no match in Linear; I’ll map it to Blocked unless Marcus prefers Backlog.',
          'Next I’ll test with the last 20 tickets before turning on the feedback source.',
        ],
        progress: 0.2,
        startedMinutesAgo: 4,
        chat: { id: 'c14', owner: 'Marcus Reid' },
      },
      {
        issue: 'SUP-120',
        agent: 'slack-support-bot',
        task: 'Retrying the double-reply fix',
        step: 'Waiting for the Slack credential to be reconnected',
        narration: [
          'The double-reply fix is ready, but the Slack credential expired so I can’t test it in a real channel.',
          'I’m waiting for someone to reconnect Slack in Credentials. I’ll retry automatically when it’s back.',
        ],
        progress: 0.6,
        startedMinutesAgo: 41,
        chat: { id: 'c3', owner: 'Marcus Reid' },
      },
    ],
    chart: {
      title: 'Billing tickets routed to the wrong agent',
      kind: 'line',
      unit: '%',
      values: [24, 27, 22, 26, 29, 25, 23, 28, 26, 24, 27, 25, 26, 24],
      releaseIndex: 13,
    },
    marker: 'v7 · pending',
    release: {
      title: 'Billing goes straight to billing, and escalations explain themselves',
      summary:
        'The router sends billing questions to the billing agent first, escalations come with a reason and an owner, and feature requests get grouped instead of answered.',
      reporters: ['Jess Park', 'Dan Ortiz'],
      channel: '#product-feedback',
    },
  },
]

export const CHANGELOG: ChangelogEntry[] = [
  ...CLAIMS_CHANGELOG,
  {
    id: 'kb-resync',
    workspaceId: 'infra',
    date: 'Sep 26',
    version: 'Product docs',
    workflows: ['slack-support-bot'],
    title: 'Answers cite the current refund policy',
    summary:
      'The Product docs knowledge base had stopped syncing on Sep 3, so the bot kept quoting the old 14-day refund window. It syncs nightly now and warns us when it falls behind.',
    changes: [
      {
        text: 'Re-synced the Product docs connector (310 documents)',
        issues: ['INF-406'],
        chat: { id: 'c10', owner: 'Ava Chen' },
      },
      {
        text: 'Switched every knowledge base to a nightly sync',
        issues: ['INF-411'],
        chat: { id: 'c10', owner: 'Ava Chen' },
      },
      {
        text: 'Alert in #infra when a knowledge base is more than 2 days stale',
        issues: ['INF-411'],
      },
    ],
    metrics: [
      {
        label: 'Answers citing outdated docs',
        before: 18,
        after: 1,
        unit: '%',
        lowerIsBetter: true,
      },
      { label: 'Days since last sync', before: 23, after: 0, lowerIsBetter: true },
    ],
    chart: {
      title: 'Answers citing outdated docs',
      kind: 'line',
      unit: '%',
      values: [9, 11, 12, 14, 15, 17, 18, 17, 19, 18, 1, 1, 0, 1],
      releaseIndex: 10,
    },
    reporters: ['Ava Chen'],
    channel: '#bot-feedback',
    live: { label: 'answers since re-sync', goodLabel: 'citing outdated docs' },
  },
  {
    id: 'bot-v13',
    workspaceId: 'infra',
    date: 'Sep 20',
    version: 'v13',
    workflows: ['slack-support-bot'],
    title: 'Replies stay in the thread they were asked in',
    summary:
      'Answers used to land in the main channel, splitting conversations in two. They now always go to the original thread.',
    changes: [
      {
        text: 'Replies post with the incoming thread, not to the channel',
        issues: ['INF-398'],
        chat: { id: 'c6', owner: 'Marcus Reid' },
      },
      {
        text: 'Top-level questions start a new thread instead of replying in-channel',
        issues: ['INF-399', 'INF-398'],
      },
    ],
    metrics: [
      { label: 'Replies posted in-channel', before: 34, after: 0, unit: '%', lowerIsBetter: true },
      { label: 'Median reply time', before: 4.6, after: 4.4, unit: 's', lowerIsBetter: true },
    ],
    chart: {
      title: 'Replies posted in-channel',
      kind: 'line',
      unit: '%',
      values: [31, 36, 33, 35, 30, 38, 34, 0, 0, 1, 0, 0, 0, 0],
      releaseIndex: 7,
    },
    reporters: ['Sam Lee', 'Dan Ortiz'],
    channel: '#bot-feedback',
  },
  {
    id: 'digest-v2',
    workspaceId: 'infra',
    date: 'Sep 15',
    version: 'v2',
    workflows: ['incident-digest'],
    title: 'Every digest item links to its run',
    summary:
      'The weekly digest now links each incident to the run that investigated it, so you can open the evidence in one click.',
    changes: [
      {
        text: 'Each item links to its run in Logs',
        issues: ['INF-395'],
        chat: { id: 'c9', owner: 'Priya Shah' },
      },
      {
        text: 'Items are grouped by workflow instead of by time',
        issues: ['INF-393'],
        chat: { id: 'c9', owner: 'Priya Shah' },
      },
    ],
    metrics: [{ label: 'Digest click-through', before: 12, after: 31, unit: '%' }],
    chart: {
      title: 'Digest click-through',
      kind: 'line',
      unit: '%',
      values: [11, 13, 12, 10, 12, 14, 12, 29, 33, 31, 30, 32, 31, 31],
      releaseIndex: 7,
    },
    reporters: [],
    channel: '#bot-feedback',
  },
  {
    id: 'support-v14',
    workspaceId: 'support',
    date: 'Sep 27',
    version: 'v14',
    workflows: ['support-agent'],
    title: 'Exports finish, and Slack replies stay in the thread',
    summary:
      'Large table exports were timing out after 30 seconds and blocking weekly reports. They now stream in pages, and the Slack bot answers in the thread it was asked in.',
    changes: [
      {
        text: 'CSV exports stream in pages instead of loading every row',
        issues: ['SUP-151'],
        chat: { id: 'c3', owner: 'Marcus Reid' },
      },
      {
        text: 'Slack replies post to the original thread',
        issues: ['SUP-150', 'SUP-120'],
        chat: { id: 'c3', owner: 'Marcus Reid' },
      },
    ],
    metrics: [
      { label: 'Export timeouts / day', before: 14, after: 0, lowerIsBetter: true },
      { label: 'Replies posted in-thread', before: 66, after: 99, unit: '%' },
    ],
    chart: {
      title: 'Export timeouts per day',
      kind: 'bar',
      values: [6, 9, 11, 8, 12, 14, 13, 10, 14, 0, 0, 1, 0, 0],
      releaseIndex: 9,
    },
    reporters: ['Jess Park', 'Dan Ortiz', 'Rae Kim'],
    channel: '#product-feedback',
    live: { label: 'exports since release', goodLabel: 'timed out' },
  },
  {
    id: 'support-v13',
    workspaceId: 'support',
    date: 'Sep 20',
    version: 'v13',
    workflows: ['support-agent'],
    title: 'Escalations carry the full ticket history',
    summary:
      'Escalated tickets used to arrive with only the last message, so humans re-asked customers for context. The whole conversation now travels with the escalation.',
    changes: [
      {
        text: 'Escalations include every message and the agent’s notes',
        issues: ['SUP-133'],
        chat: { id: 'c13', owner: 'Teddy Li' },
      },
      { text: 'Customers are not asked to repeat themselves after hand-off', issues: ['SUP-133'] },
    ],
    metrics: [
      { label: 'Escalations reopened', before: 22, after: 9, unit: '%', lowerIsBetter: true },
      { label: 'Time to first human reply', before: 41, after: 18, unit: 'm', lowerIsBetter: true },
    ],
    chart: {
      title: 'Escalations reopened',
      kind: 'line',
      unit: '%',
      values: [21, 24, 20, 23, 22, 25, 22, 10, 9, 8, 10, 9, 9, 8],
      releaseIndex: 7,
    },
    reporters: ['Priya Shah'],
    channel: '#product-feedback',
  },
  {
    id: 'router-v6',
    workspaceId: 'support',
    date: 'Sep 18',
    version: 'v6',
    workflows: ['ticket-router'],
    title: 'Billing questions go to the billing agent',
    summary: 'The router detects billing intent and hands off before the general agent answers.',
    changes: [
      {
        text: 'Added a billing-intent check before general routing',
        issues: ['SUP-129'],
        chat: { id: 'c12', owner: 'Priya Shah' },
      },
      { text: 'Shadow-ran on live traffic for two days before switching', issues: ['SUP-137'] },
    ],
    metrics: [
      { label: 'Billing tickets misrouted', before: 31, after: 6, unit: '%', lowerIsBetter: true },
    ],
    chart: {
      title: 'Billing tickets misrouted',
      kind: 'line',
      unit: '%',
      values: [30, 33, 29, 32, 31, 34, 31, 7, 6, 5, 7, 6, 6, 5],
      releaseIndex: 7,
    },
    reporters: [],
    channel: '#product-feedback',
  },
]

/** Chats that produced or are running work on an issue, newest role first. */
export function chatsForIssue(issueKey: string): (ChangeChat & { running: boolean })[] {
  const found = new Map<string, ChangeChat & { running: boolean }>()
  for (const draft of DRAFTS) {
    for (const work of draft.running)
      if (work.issue === issueKey) found.set(work.chat.id, { ...work.chat, running: true })
    for (const change of draft.changes)
      if (change.chat && change.issues.includes(issueKey) && !found.has(change.chat.id))
        found.set(change.chat.id, { ...change.chat, running: false })
  }
  for (const entry of CHANGELOG)
    for (const change of entry.changes)
      if (change.chat && change.issues.includes(issueKey) && !found.has(change.chat.id))
        found.set(change.chat.id, { ...change.chat, running: false })
  return [...found.values()]
}
