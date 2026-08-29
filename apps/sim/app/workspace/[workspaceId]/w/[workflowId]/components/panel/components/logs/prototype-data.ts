import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

export type PrototypeRunStatus = 'success' | 'error' | 'running' | 'paused'
export type PrototypeStepStatus = 'success' | 'error' | 'warning' | 'skipped'

export interface PrototypeRunStep {
  id: string
  blockId: string
  name: string
  type: string
  status: PrototypeStepStatus
  startMs: number
  durationMs: number
  /** How long this step takes on a healthy run; per-run timings scale from it. */
  typicalMs: number
  detail: string
  /**
   * What the inspector shows for this step. `definition` is whatever the step
   * actually ran — a function's code, an agent's prompt, a tool's request — so
   * the first tab is never empty for a step that exists.
   */
  /**
   * Everything the run recorded for this step, named after the fields a real
   * `LogTraceSpan` carries so the Logs trace view and this one read the same
   * shape. A span has an input and an output; anything else is optional and
   * only present where the runtime actually captured it.
   */
  inspector: {
    input: string
    output: string
    errorMessage?: string
    model?: string
    tokens?: { input: number; output: number; total: number }
    errorType?: string
    /** Zero-based, rendered one-based, matching the trace view. */
    iterationIndex?: number
    tries?: number
  }
  /**
   * Work nested inside this step — an agent's model turns and tool calls, a
   * subflow's iterations. Mirrors `LogTraceSpan.children` on the real record.
   */
  children?: PrototypeRunStep[]
}

export interface PrototypeRun {
  id: string
  label: string
  trigger: string
  status: PrototypeRunStatus
  /** Epoch ms. Range filters and the chart both read from this. */
  startedAt: number
  durationMs: number
  /** Full execution id, as the run detail shows it. */
  runId: string
  /** Which deployed version served the run — the axis a regression shows up on. */
  deploymentVersion: number
  deploymentVersionName: string | null
  /** Ledger total in dollars, matching `cost.total` on the real log record. */
  costUsd: number
  /** One-line outcome shown when hovering the run in the summary chart. */
  summary: string
  steps: PrototypeStepStatus[]
}

function createBlock(
  id: string,
  type: string,
  name: string,
  position: { x: number; y: number },
  subBlocks: Record<string, { value: string | number | null }> = {}
): BlockState {
  const normalizedSubBlocks: BlockState['subBlocks'] = {}
  for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
    normalizedSubBlocks[subBlockId] = {
      id: subBlockId,
      type: 'short-input',
      value: subBlock.value,
    }
  }

  return {
    id,
    type,
    name,
    position,
    subBlocks: normalizedSubBlocks,
    outputs: {},
    enabled: true,
    horizontalHandles: true,
    height: 0,
    advancedMode: false,
    triggerMode: type === 'starter',
    layout: {},
  }
}

export const PROTOTYPE_WORKFLOW_STATE: WorkflowState = {
  metadata: {
    name: 'Slack daily digest',
    description: 'Read every channel, summarise the day, and DM the digest',
  },
  blocks: {
    schedule: createBlock(
      'schedule',
      'schedule',
      'dailySchedule',
      { x: 0, y: 240 },
      {
        cronExpression: { value: '0 17 * * 1-5' },
      }
    ),
    listChannels: createBlock(
      'listChannels',
      'slack',
      'listChannels',
      { x: 360, y: 240 },
      {
        operation: { value: 'list_channels' },
      }
    ),
    pickChannels: createBlock(
      'pickChannels',
      'function',
      'pickChannels',
      { x: 720, y: 240 },
      {
        language: { value: 'javascript' },
        code: { value: 'return channels.filter((c) => c.is_member)' },
      }
    ),
    channelLoop: createBlock(
      'channelLoop',
      'function',
      'channelLoop',
      { x: 1080, y: 240 },
      {
        language: { value: 'javascript' },
        code: { value: 'for (const channel of <pickChannels.output>) { … }' },
      }
    ),
    buildTranscript: createBlock(
      'buildTranscript',
      'function',
      'buildTranscript',
      { x: 1440, y: 240 },
      {
        language: { value: 'javascript' },
        code: { value: 'return transcriptFor(<channelLoop.output>)' },
      }
    ),
    digestAgent: createBlock(
      'digestAgent',
      'agent',
      'digestAgent',
      { x: 1800, y: 240 },
      {
        model: { value: 'claude-sonnet-4-5' },
        systemPrompt: { value: 'Summarise the day per channel. Group bugs, features, and asks.' },
      }
    ),
    listUsers: createBlock(
      'listUsers',
      'slack',
      'listUsers',
      { x: 2160, y: 240 },
      {
        operation: { value: 'list_users' },
      }
    ),
    findAndres: createBlock(
      'findAndres',
      'function',
      'findAndres',
      { x: 2520, y: 240 },
      {
        language: { value: 'javascript' },
        code: { value: 'return users.find((u) => u.profile.email === recipient)' },
      }
    ),
    sendDigestDM: createBlock(
      'sendDigestDM',
      'slack',
      'sendDigestDM',
      { x: 2880, y: 240 },
      {
        operation: { value: 'send_message' },
      }
    ),
  },
  edges: [
    { id: 'schedule-listChannels', source: 'schedule', target: 'listChannels' },
    { id: 'listChannels-pickChannels', source: 'listChannels', target: 'pickChannels' },
    { id: 'pickChannels-channelLoop', source: 'pickChannels', target: 'channelLoop' },
    { id: 'channelLoop-buildTranscript', source: 'channelLoop', target: 'buildTranscript' },
    { id: 'buildTranscript-digestAgent', source: 'buildTranscript', target: 'digestAgent' },
    { id: 'digestAgent-listUsers', source: 'digestAgent', target: 'listUsers' },
    { id: 'listUsers-findAndres', source: 'listUsers', target: 'findAndres' },
    { id: 'findAndres-sendDigestDM', source: 'findAndres', target: 'sendDigestDM' },
  ],
  loops: {},
  parallels: {},
  lastSaved: Date.now(),
}

export const PROTOTYPE_ERROR = `TypeError: Cannot read properties of undefined (reading 'id')
    at findAndres (line 4:19)
    at WorkflowRunner.executeBlock (runner.ts:418:17)
    at async WorkflowRunner.run (runner.ts:201:9)`

export const PROTOTYPE_INPUT = `{
  "members": 38,
  "sample": {
    "id": "U04KJ2C1XQ8",
    "name": "andres",
    "is_bot": false,
    "profile": null
  }
}`

const LOOP_CHANNELS = [
  { name: 'announce', messages: 6 },
  { name: 'eng-test', messages: 41 },
  { name: 'feedback', messages: 12 },
  { name: 'eng-general', messages: 38 },
  { name: 'pull-requests', messages: 55 },
  { name: 'design-todo', messages: 9 },
  { name: 'bot', messages: 3 },
  { name: 'help-tickets', messages: 27 },
  { name: 'eng-mothership', messages: 44 },
  { name: 'releases', messages: 5 },
  { name: 'sales', messages: 14 },
  { name: 'support', messages: 19 },
  { name: 'design-review', messages: 11 },
  { name: 'incidents', messages: 1 },
  { name: 'random', messages: 8 },
] as const

/**
 * One iteration of the channel loop, each holding the two calls it made. Generated
 * rather than written out: a fifteen-channel loop is exactly the shape that makes
 * a run hard to read, and the tree has to hold it without being hand-authored.
 * Timings track message volume, so the loop's bars vary the way a real one does.
 */
function buildLoopIterations(): PrototypeRunStep[] {
  const count = LOOP_CHANNELS.length

  return LOOP_CHANNELS.map((channel, index) => {
    const fetchMs = 180 + channel.messages * 6
    const filterMs = 20 + Math.round(channel.messages / 2)
    const label = `${index + 1} / ${count}`

    return {
      id: `step-loop-${index + 1}`,
      blockId: 'channelLoop',
      name: `Iteration ${label} · #${channel.name}`,
      type: 'Iteration',
      status: 'success' as const,
      startMs: 0,
      durationMs: 0,
      typicalMs: fetchMs + filterMs,
      detail: `${channel.messages} messages`,
      inspector: {
        input: `{\n  "channel": "#${channel.name}",\n  "oldest": "1739180036"\n}`,
        output: `{\n  "channel": "#${channel.name}",\n  "messages": ${channel.messages}\n}`,
        iterationIndex: index,
      },
      children: [
        {
          id: `step-loop-${index + 1}-fetch`,
          blockId: 'channelLoop',
          name: 'fetchHistory',
          type: 'Slack',
          status: 'success' as const,
          startMs: 0,
          durationMs: 0,
          typicalMs: fetchMs,
          detail: `${channel.messages} returned`,
          inspector: {
            input: `{\n  "channel": "#${channel.name}"\n}`,
            output: `{\n  "ok": true,\n  "messages": ${channel.messages},\n  "has_more": false,\n  "response_metadata": { "next_cursor": "" }\n}`,
          },
        },
        {
          id: `step-loop-${index + 1}-filter`,
          blockId: 'channelLoop',
          name: 'dropJoinNoise',
          type: 'Function',
          status: 'success' as const,
          startMs: 0,
          durationMs: 0,
          typicalMs: filterMs,
          detail: `${Math.max(0, channel.messages - 2)} kept`,
          inspector: {
            input: `{\n  "messages": ${channel.messages}\n}`,
            output: `{\n  "messages": ${Math.max(0, channel.messages - 2)}\n}`,
          },
        },
      ],
    }
  })
}

export const PROTOTYPE_RUN_STEPS: PrototypeRunStep[] = [
  {
    id: 'step-schedule',
    blockId: 'schedule',
    name: 'dailySchedule',
    type: 'Schedule',
    status: 'success',
    startMs: 0,
    durationMs: 20,
    typicalMs: 20,
    detail: 'Fired at 17:00',
    inspector: {
      input: `{}`,
      output: `{\n  "firedAt": "17:00:00.020Z"\n}`,
    },
  },
  {
    id: 'step-listChannels',
    blockId: 'listChannels',
    name: 'listChannels',
    type: 'Slack',
    status: 'success',
    startMs: 20,
    durationMs: 413,
    typicalMs: 413,
    detail: '15 channels',
    inspector: {
      input: `{}`,
      output: `{\n  "channels": 15\n}`,
    },
  },
  {
    id: 'step-pickChannels',
    blockId: 'pickChannels',
    name: 'pickChannels',
    type: 'Function',
    status: 'success',
    startMs: 433,
    durationMs: 47,
    typicalMs: 47,
    detail: '15 kept',
    inspector: {
      input: `{\n  "channels": 15\n}`,
      output: `{\n  "channels": 15,\n  "oldest": "1739180036"\n}`,
    },
  },
  {
    id: 'step-channelLoop',
    blockId: 'channelLoop',
    name: 'channelLoop',
    type: 'Loop',
    status: 'success',
    startMs: 480,
    durationMs: 5400,
    typicalMs: 5400,
    detail: '15 iterations · 293 messages',
    inspector: {
      input: `{\n  "channels": 15\n}`,
      output: `{\n  "messages": 293,\n  "channels": 15\n}`,
    },
    children: buildLoopIterations(),
  },
  {
    id: 'step-buildTranscript',
    blockId: 'buildTranscript',
    name: 'buildTranscript',
    type: 'Function',
    status: 'success',
    startMs: 5880,
    durationMs: 226,
    typicalMs: 226,
    detail: '293 messages joined',
    inspector: {
      input: `{\n  "channels": 15,\n  "messages": 293\n}`,
      output: `{\n  "characters": 48210\n}`,
    },
  },
  {
    id: 'step-digestAgent',
    blockId: 'digestAgent',
    name: 'digestAgent',
    type: 'Agent',
    status: 'success',
    startMs: 6106,
    durationMs: 14040,
    typicalMs: 14040,
    detail: '3 tool calls · 2 turns',
    inspector: {
      input: `{\n  "characters": 48210,\n  "channels": 15\n}`,
      output: `{\n  "model": "claude-sonnet-4-5",\n  "tokens": { "input": 14204, "output": 1866, "total": 16070 }\n}`,
      model: 'claude-sonnet-4-5',
      tokens: { input: 14204, output: 1866, total: 16070 },
    },
    children: [
      {
        id: 'step-agent-turn-1',
        blockId: 'digestAgent',
        name: 'claude-sonnet-4-5',
        type: 'Model',
        status: 'success',
        startMs: 0,
        durationMs: 0,
        typicalMs: 4200,
        detail: 'Planned 3 tool calls',
        inspector: {
          input: `{\n  "characters": 48210\n}`,
          output: `{\n  "toolCalls": ["knowledge_search", "slack_reactions", "web_search"]\n}`,
          model: 'claude-sonnet-4-5',
          tokens: { input: 14204, output: 212, total: 14416 },
        },
      },
      {
        id: 'step-agent-knowledge',
        blockId: 'digestAgent',
        name: 'knowledge_search',
        type: 'Tool',
        status: 'success',
        startMs: 0,
        durationMs: 0,
        typicalMs: 1900,
        detail: '6 matches',
        inspector: {
          input: `{\n  "query": "known bugs this week"\n}`,
          output: `{\n  "matches": 6\n}`,
        },
      },
      {
        id: 'step-agent-reactions',
        blockId: 'digestAgent',
        name: 'slack_reactions',
        type: 'Tool',
        status: 'warning',
        startMs: 0,
        durationMs: 0,
        typicalMs: 2600,
        detail: 'Rate limited once, retried',
        inspector: {
          input: `{\n  "limit": 200\n}`,
          output: `{\n  "reactions": 42\n}`,
          tries: 2,
        },
      },
      {
        id: 'step-agent-web',
        blockId: 'digestAgent',
        name: 'web_search',
        type: 'Tool',
        status: 'success',
        startMs: 0,
        durationMs: 0,
        typicalMs: 1600,
        detail: '4 results',
        inspector: {
          input: `{\n  "query": "slack api conversations.history changelog"\n}`,
          output: `{\n  "results": 4\n}`,
        },
      },
      {
        id: 'step-agent-turn-2',
        blockId: 'digestAgent',
        name: 'claude-sonnet-4-5',
        type: 'Model',
        status: 'success',
        startMs: 0,
        durationMs: 0,
        typicalMs: 3740,
        detail: 'Wrote the digest',
        inspector: {
          input: `{\n  "toolResults": 3\n}`,
          output: `{\n  "characters": 2140,\n  "tokens": { "output": 1866 }\n}`,
          model: 'claude-sonnet-4-5',
          tokens: { input: 15600, output: 1654, total: 17254 },
        },
      },
    ],
  },
  {
    id: 'step-listUsers',
    blockId: 'listUsers',
    name: 'listUsers',
    type: 'Slack',
    status: 'success',
    startMs: 20146,
    durationMs: 275,
    typicalMs: 275,
    detail: '38 members',
    inspector: {
      input: `{}`,
      output: `{\n  "members": 38\n}`,
    },
  },
  {
    id: 'step-findAndres',
    blockId: 'findAndres',
    name: 'findAndres',
    type: 'Function',
    status: 'error',
    startMs: 20421,
    durationMs: 66,
    typicalMs: 66,
    detail: 'TypeError on line 4',
    inspector: {
      input: PROTOTYPE_INPUT,
      output: `{}`,
      errorMessage: PROTOTYPE_ERROR,
      errorType: 'TypeError',
    },
  },
  {
    id: 'step-sendDigestDM',
    blockId: 'sendDigestDM',
    name: 'sendDigestDM',
    type: 'Slack',
    status: 'skipped',
    startMs: 20487,
    durationMs: 0,
    typicalMs: 586,
    detail: 'Not executed',
    inspector: {
      input: `{}`,
      output: `{}`,
    },
  },
]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Wall clock the fixture is written against, read once so every timestamp and
 * every range filter agree for the life of the session.
 */
const RUNS_ANCHOR = Date.now()

const SUCCESS_STEPS: PrototypeStepStatus[] = PROTOTYPE_RUN_STEPS.map(() => 'success')
const FAILED_STEPS: PrototypeStepStatus[] = PROTOTYPE_RUN_STEPS.map((step) => step.status)

const AUTHORED_RUNS: PrototypeRun[] = [
  {
    id: 'run-2841',
    label: 'Run #2841',
    startedAt: RUNS_ANCHOR - 67 * MINUTE,
    trigger: 'Manual',
    status: 'error',
    durationMs: 20487,
    runId: 'b41f7c02-9a3d-4e15-8c77-2fd0a1e93b64',
    deploymentVersion: 4,
    deploymentVersionName: null,
    costUsd: 0.07,
    summary: 'Failed at findAndres',
    steps: FAILED_STEPS,
  },
  {
    id: 'run-2840',
    label: 'Run #2840',
    startedAt: RUNS_ANCHOR - 138 * MINUTE,
    trigger: 'Schedule',
    status: 'success',
    durationMs: 21800,
    runId: '0c9e5a71-3b84-4d02-9f16-77ab5c2e8d40',
    deploymentVersion: 4,
    deploymentVersionName: null,
    costUsd: 0.11,
    summary: 'Completed all 9 steps',
    steps: SUCCESS_STEPS,
  },
  {
    id: 'run-2839',
    label: 'Run #2839',
    startedAt: RUNS_ANCHOR - 222 * MINUTE,
    trigger: 'Webhook',
    status: 'paused',
    durationMs: 20100,
    runId: '7d21b8f4-16ca-497e-b053-9e4c1a7f2088',
    deploymentVersion: 4,
    deploymentVersionName: null,
    costUsd: 0.09,
    summary: 'Waiting for approval before step 07',
    steps: [
      'success',
      'success',
      'success',
      'success',
      'success',
      'success',
      'skipped',
      'skipped',
      'skipped',
    ],
  },
  {
    id: 'run-2838',
    label: 'Run #2838',
    startedAt: RUNS_ANCHOR - 297 * MINUTE,
    trigger: 'Schedule',
    status: 'running',
    durationMs: 6100,
    runId: 'ae63d0b9-5f27-4c31-a8de-0b91c46e7fa2',
    deploymentVersion: 4,
    deploymentVersionName: null,
    costUsd: 0.04,
    summary: 'Running · step 06 of 09',
    steps: [
      'success',
      'success',
      'success',
      'success',
      'success',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ],
  },
  {
    id: 'run-2837',
    label: 'Run #2837',
    startedAt: RUNS_ANCHOR - 1176 * MINUTE,
    trigger: 'API',
    status: 'success',
    durationMs: 21400,
    runId: '31c7e94a-8d60-4b25-9107-c5ea2f83b6d1',
    deploymentVersion: 3,
    deploymentVersionName: null,
    costUsd: 0.1,
    summary: 'Completed all 9 steps',
    steps: SUCCESS_STEPS,
  },
  {
    id: 'run-2836',
    label: 'Run #2836',
    startedAt: RUNS_ANCHOR - 1313 * MINUTE,
    trigger: 'Manual',
    status: 'error',
    durationMs: 19800,
    runId: '5f80a2d3-4e19-4a76-bc38-16d7e905c4b8',
    deploymentVersion: 3,
    deploymentVersionName: null,
    costUsd: 0.06,
    summary: 'Failed at findAndres',
    steps: FAILED_STEPS,
  },
  {
    id: 'run-2835',
    label: 'Run #2835',
    startedAt: RUNS_ANCHOR - 1445 * MINUTE,
    trigger: 'API',
    status: 'success',
    durationMs: 22600,
    runId: 'c2a496e8-7b13-4f50-8d29-3a6b0ec185f7',
    deploymentVersion: 3,
    deploymentVersionName: null,
    costUsd: 0.1,
    summary: 'Completed all 9 steps',
    steps: SUCCESS_STEPS,
  },
]

/** Stable value-noise, so the same fixture renders identically every mount. */
function seeded(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function seededId(seed: number): string {
  const chunk = (offset: number, size: number) =>
    Math.floor(seeded(seed + offset) * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
      .slice(0, size)
  return `${chunk(1, 8)}-${chunk(2, 4)}-${chunk(3, 4)}-${chunk(4, 4)}-${chunk(5, 8)}${chunk(6, 4)}`
}

const HISTORY_TRIGGERS = ['Manual', 'Schedule', 'Webhook', 'API'] as const

/**
 * Runs older than the authored ones. The panel has to hold a workflow's whole
 * history, not a handful of rows, so the fixture carries enough of it that the
 * range filter and the chart's bucketing are exercised for real.
 */
function buildHistoryRuns(count: number): PrototypeRun[] {
  const runs: PrototypeRun[] = []
  /* Gaps accumulate, so each run really is older than the one before it. */
  let age = 2 * DAY

  for (let step = 1; step <= count; step++) {
    age += 5 * HOUR + seeded(step) * 10 * HOUR
    const number = 2835 - step
    const failed = seeded(step + 500) < 0.12
    const ageDays = age / DAY

    runs.push({
      id: `run-${number}`,
      label: `Run #${number}`,
      startedAt: RUNS_ANCHOR - age,
      trigger: HISTORY_TRIGGERS[step % HISTORY_TRIGGERS.length],
      status: failed ? 'error' : 'success',
      durationMs: Math.round(17000 + seeded(step + 900) * 9000),
      runId: seededId(step),
      /* Older runs came from older deploys, so a regression has somewhere to start. */
      deploymentVersion: ageDays > 30 ? 1 : ageDays > 14 ? 2 : ageDays > 3 ? 3 : 4,
      deploymentVersionName: null,
      costUsd: Math.round((0.06 + seeded(step + 1300) * 0.05) * 100) / 100,
      summary: failed ? 'Failed at findAndres' : 'Completed all 9 steps',
      steps: failed ? FAILED_STEPS : SUCCESS_STEPS,
    })
  }

  return runs
}

const HISTORY_RUNS = buildHistoryRuns(113)

/** Newest first, the order every surface reads them in. */
export const PROTOTYPE_RUNS: PrototypeRun[] = [...AUTHORED_RUNS, ...HISTORY_RUNS].sort(
  (a, b) => b.startedAt - a.startedAt
)

export type RunRange = 'all' | '30d' | '7d' | '24h'

export const RUN_RANGES: Array<{ value: RunRange; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Past 30 days' },
  { value: '7d', label: 'Past 7 days' },
  { value: '24h', label: 'Past 24 hours' },
]

const RANGE_SPAN_MS: Record<RunRange, number | null> = {
  all: null,
  '30d': 30 * DAY,
  '7d': 7 * DAY,
  '24h': 24 * HOUR,
}

export function getRunsInRange(range: RunRange): PrototypeRun[] {
  const span = RANGE_SPAN_MS[range]
  if (span === null) return PROTOTYPE_RUNS
  const cutoff = RUNS_ANCHOR - span
  return PROTOTYPE_RUNS.filter((run) => run.startedAt >= cutoff)
}

/** Run rows render the clock the way the Logs table does. */
export function formatRunTime(startedAt: number): string {
  const date = new Date(startedAt)
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const midnight = new Date(RUNS_ANCHOR)
  midnight.setHours(0, 0, 0, 0)

  if (startedAt >= midnight.getTime()) return `Today, ${clock}`
  if (startedAt >= midnight.getTime() - DAY) return `Yesterday, ${clock}`
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${clock}`
}

/**
 * The columns the run list sorts by, matching the workspace Logs page's own so
 * the two surfaces sort the same runs the same ways. Direction is carried
 * separately, the way `SortConfig` expects.
 */
export const RUN_SORT_COLUMNS = [
  { id: 'date', label: 'Date' },
  { id: 'duration', label: 'Duration' },
  { id: 'cost', label: 'Cost' },
  { id: 'status', label: 'Status' },
] as const

export type RunSortState = { column: string; direction: 'asc' | 'desc' } | null

/** Statuses a run can be filtered to, labelled as the Logs page labels them. */
export const RUN_STATUS_OPTIONS = [
  { value: 'success', label: 'Completed' },
  { value: 'error', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
] as const

/** Triggers present in the fixture. */
export const RUN_TRIGGER_OPTIONS = [
  { value: 'Manual', label: 'Manual' },
  { value: 'Schedule', label: 'Schedule' },
  { value: 'Webhook', label: 'Webhook' },
  { value: 'API', label: 'API' },
] as const

/** Failures first, then anything unsettled, then the runs that passed. */
const STATUS_RANK: Record<PrototypeRunStatus, number> = {
  error: 0,
  running: 1,
  paused: 2,
  success: 3,
}

export interface RunListFilters {
  query: string
  statuses: string[]
  triggers: string[]
  sort: RunSortState
}

/**
 * The runs a filtered, sorted list should show. The query is matched against
 * everything a row displays plus the run id, so a pasted id finds its run.
 */
export function getVisibleRuns(runs: PrototypeRun[], filters: RunListFilters): PrototypeRun[] {
  const needle = filters.query.trim().toLowerCase()

  const matched = runs.filter((run) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(run.status)) return false
    if (filters.triggers.length > 0 && !filters.triggers.includes(run.trigger)) return false
    if (!needle) return true
    return [run.label, run.trigger, run.summary, run.runId].some((field) =>
      field.toLowerCase().includes(needle)
    )
  })

  if (!filters.sort) return matched

  const { column, direction } = filters.sort
  const sign = direction === 'asc' ? 1 : -1

  /* A copy: the source is module state every other surface reads. */
  return [...matched].sort((a, b) => {
    if (column === 'duration') return (a.durationMs - b.durationMs) * sign
    if (column === 'cost') return (a.costUsd - b.costUsd) * sign
    if (column === 'status') {
      const rank = (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * sign
      if (rank !== 0) return rank
      return b.startedAt - a.startedAt
    }
    return (a.startedAt - b.startedAt) * sign
  })
}

export interface RunBucket {
  key: string
  runs: PrototypeRun[]
  failedCount: number
}

/**
 * Columns for the chart, oldest first. Below the column budget each run keeps
 * its own bar; above it runs are grouped into equal slices of the range, which
 * is what lets a year of history stay one readable strip.
 */
export function getRunBuckets(runs: PrototypeRun[], maxColumns: number): RunBucket[] {
  const oldestFirst = [...runs].sort((a, b) => a.startedAt - b.startedAt)
  if (oldestFirst.length === 0) return []

  if (oldestFirst.length <= maxColumns) {
    return oldestFirst.map((run) => ({
      key: run.id,
      runs: [run],
      failedCount: run.status === 'error' ? 1 : 0,
    }))
  }

  const first = oldestFirst[0].startedAt
  const span = Math.max(oldestFirst[oldestFirst.length - 1].startedAt - first, 1)
  const buckets: RunBucket[] = Array.from({ length: maxColumns }, (_, index) => ({
    key: `bucket-${index}`,
    runs: [],
    failedCount: 0,
  }))

  for (const run of oldestFirst) {
    const slot = Math.min(maxColumns - 1, Math.floor(((run.startedAt - first) / span) * maxColumns))
    buckets[slot].runs.push(run)
    if (run.status === 'error') buckets[slot].failedCount += 1
  }

  return buckets
}

/** Renders a millisecond duration the way run rows and step rows show it. */
export function formatMs(ms: number): string {
  if (ms <= 0) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

export interface PrototypeRunStepView extends PrototypeRunStep {
  index: number
  /** 0 for a workflow step, 1+ for work nested inside one. */
  depth: number
  hasChildren: boolean
}

/**
 * The step timeline for one run. Names and topology are fixed by the workflow;
 * each run supplies its own per-step outcome, and timings scale off the
 * healthy-run baseline so they add up to that run's recorded total.
 */
export function getRunSteps(run: PrototypeRun): PrototypeRunStepView[] {
  const activeTotal = PROTOTYPE_RUN_STEPS.reduce(
    (total, step, index) => (run.steps[index] === 'skipped' ? total : total + step.typicalMs),
    0
  )
  const scale = activeTotal > 0 ? run.durationMs / activeTotal : 0

  let startMs = 0
  return PROTOTYPE_RUN_STEPS.map((step, index) => {
    const status = run.steps[index] ?? 'skipped'
    const durationMs = status === 'skipped' ? 0 : Math.round(step.typicalMs * scale)
    const view: PrototypeRunStepView = {
      ...step,
      index,
      depth: 0,
      /* A step that never ran has nothing nested to show. */
      hasChildren: status !== 'skipped' && Boolean(step.children?.length),
      status,
      startMs,
      durationMs,
    }
    startMs += durationMs
    return view
  })
}

/** Indent per nesting level, matching the Logs trace view. */
export const STEP_INDENT_PX = 12

/**
 * The visible rows for a step list: every step, plus the children of the ones
 * currently expanded. Child timings divide their parent's measured duration in
 * proportion to their healthy-run baselines, so a nested row stays a true slice
 * of the row above it.
 */
export function flattenRunSteps(
  steps: PrototypeRunStepView[],
  expanded: ReadonlySet<string>
): PrototypeRunStepView[] {
  const rows: PrototypeRunStepView[] = []

  const walk = (step: PrototypeRunStepView) => {
    rows.push(step)
    if (!step.hasChildren || !expanded.has(step.id)) return

    const children = step.children ?? []
    const baseline = children.reduce((total, child) => total + child.typicalMs, 0) || 1
    let startMs = step.startMs

    for (const child of children) {
      const durationMs = Math.round((child.typicalMs / baseline) * step.durationMs)
      const view: PrototypeRunStepView = {
        ...child,
        index: step.index,
        depth: step.depth + 1,
        hasChildren: child.status !== 'skipped' && Boolean(child.children?.length),
        startMs,
        durationMs,
      }
      startMs += durationMs
      /* Recursive: a loop holds iterations, and an iteration holds its own calls. */
      walk(view)
    }
  }

  for (const step of steps) walk(step)

  return rows
}

/** Steps a run had to repeat before moving on. */
export function getRunRetryCount(run: PrototypeRun): number {
  return run.steps.filter((status) => status === 'warning').length
}

/** Steps a run never reached, because it failed or is still going. */
export function getRunSkippedCount(run: PrototypeRun): number {
  return run.steps.filter((status) => status === 'skipped').length
}

/** Ledger totals render as plain dollars, the way the run record stores them. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Health across the runs on record. Derived rather than authored so the tiles
 * cannot drift from the list beneath them — a run that changes outcome changes
 * the rate, the median and the total with it.
 */
export function getRunsSummary(runs: PrototypeRun[]) {
  const finished = runs.filter((run) => run.status === 'success' || run.status === 'error')
  const successes = finished.filter((run) => run.status === 'success').length
  const durations = finished.map((run) => run.durationMs).sort((a, b) => a - b)
  const middle = Math.floor(durations.length / 2)

  return {
    finishedCount: finished.length,
    failedCount: finished.length - successes,
    successRate: finished.length ? Math.round((successes / finished.length) * 100) : 0,
    medianMs: durations.length
      ? durations.length % 2 === 1
        ? durations[middle]
        : Math.round((durations[middle - 1] + durations[middle]) / 2)
      : 0,
    totalCostUsd: runs.reduce((total, run) => total + run.costUsd, 0),
  }
}

export const PROTOTYPE_EXECUTED_BLOCKS = Object.fromEntries(
  PROTOTYPE_RUN_STEPS.map((step) => [
    step.blockId,
    {
      status:
        step.status === 'error' ? 'error' : step.status === 'skipped' ? 'not-executed' : 'success',
    },
  ])
)
