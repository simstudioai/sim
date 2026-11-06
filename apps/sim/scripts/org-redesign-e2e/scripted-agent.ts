import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { sleep } from '@sim/utils/helpers'

/**
 * Stands in for the Mothership worker at the main app's `SIM_AGENT_API_URL`, so a chat turn crosses
 * every real boundary of the app and only the model's words are scripted. A message containing
 * `Count slowly` streams until the app hangs up, which is what Stop needs; anything else answers at
 * once. Same wire format as the desktop suite's `ScriptedAgent`.
 *
 * A message naming `scripted:<scenario> key=value ...` runs that scenario instead: tool calls,
 * approvals, every special tag, a failure, and a stream that loses its connection and replays from
 * the receipt the app re-attaches with. Those are the worker behaviours `test-workspace-chat-e2e.ts`
 * drives the chat through.
 *
 * `GET /__e2e/requests?contains=<text>` lists what the app sent, and `POST /__e2e/release` with
 * `{ "gate": "<name>" }` lets a scenario holding on `gate=<name>` go on, so a suite waits on a
 * condition rather than on the agent's timing.
 */
const port = Number(process.argv[2])
if (!port) throw new Error('usage: scripted-agent.ts <port>')

/** Keeps a long run's recording bounded: suites read recent requests by a token they own. */
const MAX_RECORDED_REQUESTS = 2_000
const TEXT_CHUNK_CHARS = 48
const TEXT_CHUNK_MS = 15
const KEEPALIVE_MS = 5_000

type Body = Record<string, unknown>

interface RecordedRequest {
  path: string
  body: Body
  at: string
}

const recorded: RecordedRequest[] = []
const releasedGates = new Set<string>()
const gateWaiters = new Map<string, Set<() => void>>()

/** A turn parked on a checkpoint, continued by the app's `/api/tools/resume`. */
const parkedTurns = new Map<string, (turn: Turn, results: unknown[]) => Promise<void>>()
/** How many legs a stream id has opened: the app re-attaches a lost leg under the same id. */
const legsByStream = new Map<string, number>()
/** Whether a `fail-once` token has spent its failure. */
const failedTokens = new Set<string>()

async function readJson(request: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** Holds a turn until the suite lets it go, with the keepalives a worker sends while it thinks. */
function waitForGate(gate: string, turn: Turn): Promise<void> {
  if (releasedGates.has(gate)) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = gateWaiters.get(gate) ?? new Set()
    gateWaiters.set(gate, waiters)
    const keepalive = setInterval(() => turn.keepalive(), KEEPALIVE_MS)
    const settle = () => {
      clearInterval(keepalive)
      waiters.delete(settle)
      resolve()
    }
    waiters.add(settle)
    turn.onClose(settle)
  })
}

function releaseGate(gate: string) {
  releasedGates.add(gate)
  for (const settle of [...(gateWaiters.get(gate) ?? [])]) settle()
}

/** One open response: the frames of a turn, in the envelope the app's parser accepts. */
class Turn {
  private seq = 0
  private closeListeners = new Set<() => void>()
  open = true
  /** Assistant characters written, for a scenario that addresses text by offset. */
  textOffset = 0

  constructor(
    private readonly response: ServerResponse,
    readonly streamId: string,
    readonly chatId: string | undefined,
    readonly body: Body
  ) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.on('close', () => {
      this.open = false
      for (const listener of [...this.closeListeners]) listener()
    })
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener)
  }

  emit(type: string, payload: Record<string, unknown>) {
    if (!this.open) return
    this.seq += 1
    const envelope = {
      v: 1,
      type,
      seq: this.seq,
      ts: new Date().toISOString(),
      stream: {
        streamId: this.streamId,
        ...(this.chatId ? { chatId: this.chatId } : {}),
        cursor: String(this.seq),
      },
      trace: { requestId: `live-${this.streamId}` },
      payload,
    }
    this.response.write(`data: ${JSON.stringify(envelope)}\n\n`)
  }

  keepalive() {
    if (this.open) this.response.write(': keepalive\n\n')
  }

  /** Writes text in chunks small enough to split a tag across frames, as a model's tokens do. */
  async text(text: string, options: { chunkChars?: number; chunkMs?: number } = {}) {
    const chunkChars = options.chunkChars ?? TEXT_CHUNK_CHARS
    const chunkMs = options.chunkMs ?? TEXT_CHUNK_MS
    for (let start = 0; start < text.length && this.open; start += chunkChars) {
      this.emit('text', { channel: 'assistant', text: text.slice(start, start + chunkChars) })
      await sleep(chunkMs)
    }
  }

  toolCall(
    id: string,
    name: string,
    description: string,
    options: { executor?: string; status?: string; args?: Record<string, unknown> } = {}
  ) {
    this.emit('tool', {
      phase: 'call',
      executor: options.executor ?? 'go',
      mode: 'async',
      toolCallId: id,
      toolName: name,
      activityDescription: description,
      arguments: options.args ?? {},
      ...(options.status ? { status: options.status } : {}),
    })
  }

  toolResult(id: string, name: string, outcome: { error?: string; output?: unknown } = {}) {
    const failed = outcome.error !== undefined
    this.emit('tool', {
      phase: 'result',
      executor: 'go',
      mode: 'async',
      toolCallId: id,
      toolName: name,
      success: !failed,
      status: failed ? 'error' : 'success',
      ...(failed ? { error: outcome.error } : { output: outcome.output ?? { ok: true } }),
    })
  }

  /** Parks the turn until the app reports its pending tools through `/api/tools/resume`. */
  checkpoint(
    pendingToolCallIds: string[],
    resume: (turn: Turn, results: unknown[]) => Promise<void>
  ) {
    parkedTurns.set(this.streamId, resume)
    this.emit('run', {
      kind: 'checkpoint_pause',
      checkpointId: `checkpoint-${this.streamId}`,
      executionId: '',
      runId: '',
      pendingToolCallIds,
    })
    this.finishLeg()
  }

  /** Ends this leg with no terminal event: the turn goes on in a later one. */
  finishLeg() {
    if (!this.open) return
    this.open = false
    this.response.end()
  }

  /** Severs the socket mid-stream, the way a worker replacement or a network fault does. */
  sever() {
    this.open = false
    this.response.destroy()
  }

  complete(status: 'complete' | 'error' = 'complete', extra: Record<string, unknown> = {}) {
    if (!this.open) return
    this.emit('complete', { status, ...extra })
    this.finishLeg()
  }
}

const countLine = (token: string, line: number) => `${token}-${String(line).padStart(3, '0')}`

function tag(name: string, payload: unknown) {
  return `<${name}>${JSON.stringify(payload)}</${name}>`
}

/** A count that reports each line once, for a suite asserting nothing is lost or repeated. */
async function streamCount(turn: Turn, params: Params) {
  const lines = Number(params.n ?? 20)
  const ms = Number(params.ms ?? 150)
  for (let line = 1; line <= lines && turn.open; line += 1) {
    if (params.gate && line === Number(params.gateAt ?? 1)) await waitForGate(params.gate, turn)
    turn.emit('text', { channel: 'assistant', text: `${countLine(params.token, line)}\n\n` })
    await sleep(ms)
  }
  turn.complete()
}

/** Replays from just before the app's receipt: the overlap must not reach the transcript twice. */
async function streamResumable(turn: Turn, params: Params, leg: number) {
  const lines = Number(params.n ?? 12)
  const severAfter = Number(params.severAfter ?? 5)
  const ms = Number(params.ms ?? 120)
  const script = Array.from({ length: lines }, (_, i) => `${countLine(params.token, i + 1)}\n\n`)
  const full = script.join('')
  const received = typeof turn.body.receivedTextChars === 'number' ? turn.body.receivedTextChars : 0
  const lineLength = script[0]?.length ?? 1
  let cursor = leg === 1 ? 0 : Math.max(0, received - lineLength)
  let sent = 0
  while (cursor < full.length && turn.open) {
    const next = full.slice(cursor, cursor + lineLength)
    turn.emit('text', { channel: 'assistant', text: next, textOffset: cursor })
    cursor += next.length
    sent += 1
    if (leg === 1 && sent === severAfter) {
      turn.sever()
      return
    }
    await sleep(ms)
  }
  turn.complete('complete', { textLength: full.length })
}

interface Params {
  token: string
  [key: string]: string
}

type Scenario = (turn: Turn, params: Params, leg: number) => Promise<void> | void

const SCENARIOS: Record<string, Scenario> = {
  markdown: async (turn, params) => {
    await turn.text(
      [
        `## Release notes ${params.token}`,
        '',
        'The **bold claim** sits beside `inline_code` and a [plain link](https://docs.example.com/guide).',
        '',
        '- First item',
        '- Second item',
        '',
        '| Region | Status |',
        '| --- | --- |',
        '| North | Ready |',
        '',
        '```ts',
        'const answer: number = 42',
        'export function double(value: number) {',
        '  return value * 2',
        '}',
        '```',
        '',
        `All done ${params.token}.`,
      ].join('\n')
    )
    turn.complete()
  },

  hostile: async (turn, params) => {
    await turn.text(
      [
        `Hostile content ${params.token}.`,
        '',
        '[markdown link](javascript:window.__chatXss=1)',
        '',
        '<a href="javascript:window.__chatXss=2">raw anchor</a>',
        '',
        '<img src="x" onerror="window.__chatXss=3">',
        '',
        '<script>window.__chatXss=4</script>',
        '',
        '<iframe srcdoc="<script>parent.__chatXss=5</script>"></iframe>',
        '',
        '<svg onload="window.__chatXss=6"></svg>',
        '',
        '<button onclick="window.__chatXss=7">raw button</button>',
        '',
        tag('credential', {
          type: 'link',
          provider: 'gmail',
          value: 'javascript:window.__chatXss=8',
        }),
        '',
        `Hostile end ${params.token}.`,
      ].join('\n')
    )
    turn.complete()
  },

  count: (turn, params) => streamCount(turn, params),

  resumable: (turn, params, leg) => streamResumable(turn, params, leg),

  'fail-once': async (turn, params) => {
    if (!failedTokens.has(params.token)) {
      failedTokens.add(params.token)
      await turn.text(`Partial answer ${params.token}.`)
      turn.emit('error', {
        message: `Scripted failure ${params.token}`,
        displayMessage: `Scripted failure ${params.token}`,
        code: 'scripted_failure',
      })
      turn.complete('error')
      return
    }
    await turn.text(`Recovered answer ${params.token}.`)
    turn.complete()
  },

  tools: async (turn, params) => {
    const { token } = params
    await turn.text(`Starting tools ${token}.\n\n`)
    turn.toolCall(`${token}-one`, 'search_online', `Searching handbook ${token}`)
    await waitForGate(`${token}-first`, turn)
    turn.toolResult(`${token}-one`, 'search_online')
    turn.toolCall(`${token}-two`, 'search_online', `Searching archive ${token}`)
    turn.toolResult(`${token}-two`, 'search_online', { error: `Archive offline ${token}` })
    turn.toolCall(`${token}-three`, 'search_online', `Searching wiki ${token}`)
    turn.toolResult(`${token}-three`, 'search_online')
    await turn.text(`Tools finished ${token}.`)
    turn.complete()
  },

  approval: async (turn, params) => {
    const { token } = params
    const count = Number(params.n ?? 1)
    const ids = Array.from({ length: count }, (_, i) => `${token}-call-${i + 1}`)
    await turn.text(`Asking first ${token}.\n\n`)
    ids.forEach((id, index) => {
      turn.toolCall(id, 'cancel_workflow_run', `Cancelling run ${token} ${index + 1}`, {
        executor: 'sim',
        status: 'awaiting_approval',
        args: { workflowId: `${token}-workflow`, executionId: id },
      })
    })
    turn.checkpoint(ids, async (resumed, results) => {
      const declined = results.filter((result) => JSON.stringify(result).includes('user_declined'))
      await resumed.text(`Resumed ${token} declined ${declined.length} of ${results.length}.`)
      resumed.complete()
    })
  },

  question: async (turn, params) => {
    await turn.text(`Before I go on ${params.token}.\n\n`)
    await turn.text(
      tag('question', [
        {
          type: 'single_select',
          prompt: `Which region ${params.token}?`,
          options: [
            { id: 'north', label: 'North' },
            { id: 'south', label: 'South' },
          ],
        },
      ])
    )
    turn.complete()
  },

  credential: async (turn, params) => {
    await turn.text(`Connect this first ${params.token}.\n\n`)
    await turn.text(
      tag('credential', [
        { type: 'link', provider: 'gmail', value: `https://connect.example.com/${params.token}` },
        { type: 'secret_input', name: 'WORKSPACE_CHAT_E2E_KEY' },
      ])
    )
    turn.complete()
  },

  'usage-upgrade': async (turn, params) => {
    await turn.text(`Out of room ${params.token}.\n\n`)
    await turn.text(
      tag('usage_upgrade', {
        reason: 'usage_limit',
        action: 'upgrade_plan',
        message: `You are out of credits ${params.token}.`,
      })
    )
    turn.complete()
  },

  options: async (turn, params) => {
    await turn.text(`Here is the answer ${params.token}.\n\n`)
    await turn.text(
      tag('options', {
        1: { title: `Draft a summary ${params.token}`, description: 'A short summary' },
        2: { title: `List the risks ${params.token}`, description: 'The main risks' },
      })
    )
    turn.complete()
  },

  citations: async (turn, params) => {
    await turn.text(`The bulletin says so ${params.token}. `)
    await turn.text(
      tag('source', {
        url: `https://docs.example.com/${params.token}/bulletin`,
        title: `Service bulletin ${params.token}`,
        siteName: 'Example Docs',
      })
    )
    await turn.text(' The playbook agrees. ')
    await turn.text(
      tag('source', {
        url: `https://wiki.example.com/${params.token}/playbook`,
        title: `Recall playbook ${params.token}`,
        siteName: 'Example Wiki',
      })
    )
    turn.complete()
  },

  plan: async (turn, params) => {
    turn.toolCall(`${params.token}-plan`, 'update_plan', `Updating plan ${params.token}`)
    turn.toolResult(`${params.token}-plan`, 'update_plan')
    await turn.text(`Plan turn ${params.token} mode ${String(turn.body.mode ?? 'none')}.`)
    turn.complete()
  },
}

const SCENARIO_PATTERN = /scripted:([a-z0-9-]+)((?:\s+[a-zA-Z]+=\S+)*)/

function parseScenario(message: string): { name: string; params: Params } | null {
  const match = message.match(SCENARIO_PATTERN)
  if (!match) return null
  const params: Params = { token: 'token' }
  for (const pair of match[2].trim().split(/\s+/).filter(Boolean)) {
    const [key, value] = pair.split('=')
    params[key] = value
  }
  return { name: match[1], params }
}

function streamDefaultTurn(turn: Turn, message: string) {
  turn.emit('session', { kind: 'start' })
  if (!message.includes('Count slowly')) {
    turn.emit('text', { channel: 'assistant', text: 'Hello from the scripted agent.' })
    turn.complete()
    return
  }
  let count = 0
  const timer = setInterval(() => {
    count += 1
    if (!turn.open || count > 50) {
      clearInterval(timer)
      turn.complete()
      return
    }
    turn.emit('text', { channel: 'assistant', text: `${count}\n` })
  }, 500)
}

function streamTurn(body: Body, response: ServerResponse) {
  const message = typeof body.message === 'string' ? body.message : ''
  const streamId = typeof body.messageId === 'string' ? body.messageId : `${Date.now()}`
  const chatId = typeof body.chatId === 'string' ? body.chatId : undefined
  const leg = (legsByStream.get(streamId) ?? 0) + 1
  legsByStream.set(streamId, leg)
  const scenario = parseScenario(message)
  const run = scenario ? SCENARIOS[scenario.name] : undefined
  if (scenario?.name === 'http-402') {
    response.writeHead(402, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Usage limit reached' }))
    return
  }
  const turn = new Turn(response, streamId, chatId, body)
  if (!scenario || !run) {
    streamDefaultTurn(turn, message)
    return
  }
  turn.emit('session', { kind: 'start' })
  void Promise.resolve(run(turn, scenario.params, leg)).catch((error: unknown) => {
    turn.emit('error', { message: `Scripted scenario failed: ${String(error)}` })
    turn.complete('error')
  })
}

function resumeTurn(body: Body, response: ServerResponse) {
  const streamId = typeof body.streamId === 'string' ? body.streamId : ''
  const results = Array.isArray(body.results) ? body.results : []
  const resume = parkedTurns.get(streamId)
  const turn = new Turn(response, streamId, undefined, body)
  if (!resume) {
    turn.complete()
    return
  }
  parkedTurns.delete(streamId)
  void resume(turn, results).catch((error: unknown) => {
    turn.emit('error', { message: `Scripted resume failed: ${String(error)}` })
    turn.complete('error')
  })
}

function record(path: string, body: Body) {
  recorded.push({ path, body, at: new Date().toISOString() })
  if (recorded.length > MAX_RECORDED_REQUESTS) recorded.shift()
}

function respondJson(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://agent')
  const path = url.pathname
  if (path === '/__e2e/requests') {
    const contains = url.searchParams.get('contains')
    respondJson(response, {
      requests: contains
        ? recorded.filter((entry) => JSON.stringify(entry).includes(contains))
        : recorded,
    })
    return
  }
  void readJson(request)
    .then((body) => {
      if (path === '/__e2e/release') {
        releaseGate(String(body.gate))
        respondJson(response, { released: true })
        return
      }
      record(path, body)
      if (path === '/api/mothership' || path === '/api/copilot') {
        streamTurn(body, response)
        return
      }
      if (path === '/api/tools/resume') {
        resumeTurn(body, response)
        return
      }
      respondJson(
        response,
        path === '/api/generate-chat-title' ? { title: 'Scripted chat' } : { settled: true }
      )
    })
    .catch(() => {
      response.writeHead(500)
      response.end()
    })
}).listen(port, '127.0.0.1')
