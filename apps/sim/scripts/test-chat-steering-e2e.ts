import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { dirname, join, resolve } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  expect as playwrightExpect,
} from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { organizationRoutes } from '@/lib/navigation/paths'
import { CHAT_PLACEHOLDERS } from '@/app/(product)/_components/chat/conversation/model'

/**
 * Proves chat steering across every real boundary: a real browser, the real Sim app, the real
 * Mothership worker, real Postgres and Redis. Only the model's words are faked, by a local server
 * speaking Anthropic's streaming Messages API behind the worker's `COPILOT_ANTHROPIC_BASE_URL`, and
 * it holds a response open until a check releases it, so a check decides exactly when a model step
 * ends. A recording proxy between Sim and the worker logs every worker call and SSE frame, and can
 * refuse a path to stand in for a worker that cannot be reached.
 *
 * Each check starts on the organization's Home, whose Build composer hands the first message to a
 * new organization chat, and drives that chat from then on. Every check asserts on the browser DOM,
 * the persisted `copilot_messages` rows, and the requests the fake model received.
 * `scripts/chat-steering-e2e.sh run` boots the stack and runs this.
 */
const logger = createLogger('ChatSteeringE2E')
const expect = playwrightExpect.configure({ timeout: 60_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

function loopbackOrigin(name: string): URL {
  const url = new URL(requiredEnvironment(name))
  assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname), `${name} must be loopback`)
  assert.equal(url.protocol, 'http:')
  return url
}

const baseUrl = loopbackOrigin('CHAT_STEERING_E2E_BASE_URL')
const workerUrl = loopbackOrigin('CHAT_STEERING_E2E_WORKER_URL')
const proxyPort = Number(requiredEnvironment('CHAT_STEERING_E2E_PROXY_PORT'))
const modelPort = Number(requiredEnvironment('CHAT_STEERING_E2E_MODEL_PORT'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('CHAT_STEERING_E2E_DATABASE_URL')
)
const workerDatabaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('CHAT_STEERING_E2E_WORKER_DATABASE_URL')
)
const authSecret = requiredEnvironment('CHAT_STEERING_E2E_AUTH_SECRET')
const reportPath = requiredEnvironment('CHAT_STEERING_E2E_REPORT_PATH')
const uploadsPath = resolve(requiredEnvironment('CHAT_STEERING_E2E_UPLOADS_PATH'))
const only = process.env.CHAT_STEERING_E2E_ONLY?.split(',').map((scenario) => scenario.trim())

const sql = postgres(databaseUrl.toString(), { max: 2, onnotice: () => {} })
const workerSql = postgres(workerDatabaseUrl.toString(), { max: 2, onnotice: () => {} })

const userId = generateId()
const workspaceId = generateId()
const organizationId = generateId()
const sessionToken = generateShortId()
const startedAt = new Date().toISOString()

interface CheckResult {
  name: string
  status: 'passed' | 'failed' | 'skipped'
  durationMs: number
  error?: string
  evidence?: unknown
}
const checks: CheckResult[] = []

const openGates = new Set<() => void>()

/** A point a held model response waits at until a check lets it finish. */
function createGate() {
  let release = () => {}
  const released = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  openGates.add(release)
  return { release, released }
}
type Gate = ReturnType<typeof createGate>

interface ModelStep {
  /** Streamed as soon as the request arrives. */
  text: string
  /** Holds the response open after `text`, until released. */
  gate?: Gate
  /** Ends the step with this tool call instead of `end_turn`, so the run takes another step. */
  tool?: { name: string; input: unknown }
}

interface ModelRequest {
  index: number
  /** The agent loop's request (it offers tools), as opposed to a title or similar one-off. */
  main: boolean
  stream: boolean
  model: unknown
  messageCount: number
  /** The whole conversation as sent, for counting how often a message reached the model. */
  prompt: string
  lastMessage: string
  receivedAt: number
  /** The worker hung up before the response finished, as a Stop does. */
  closedEarly: boolean
  /** The step it was answered with had a gate. */
  held: boolean
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * Answers the worker as Anthropic would. Main requests take their answer from a queue a check
 * fills, or a one-line default; every other request (titles) gets a short reply and no queue slot.
 */
class FakeModel {
  readonly requests: ModelRequest[] = []
  private readonly steps: ((request: ModelRequest) => ModelStep)[] = []
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch((error) => {
      logger.error('Fake model failed', { error: getErrorMessage(error) })
      response.destroy()
    })
  })

  enqueue(...steps: (ModelStep | ((request: ModelRequest) => ModelStep))[]) {
    for (const step of steps) this.steps.push(typeof step === 'function' ? step : () => step)
  }

  /** Clears what a failed check left queued, so it cannot answer the next one. */
  resetScript() {
    this.steps.length = 0
  }

  /** The agent loop's requests whose conversation holds this text, oldest first. */
  containing(text: string): ModelRequest[] {
    return this.requests.filter((request) => request.main && request.prompt.includes(text))
  }

  async waitFor(text: string): Promise<ModelRequest> {
    await expect
      .poll(() => this.containing(text).length, { message: `model request holding "${text}"` })
      .toBeGreaterThan(0)
    const [first] = this.containing(text)
    assert(first)
    return first
  }

  listen() {
    return new Promise<void>((resolvePromise, reject) => {
      this.server.once('error', reject)
      this.server.listen(modelPort, '127.0.0.1', resolvePromise)
    })
  }

  close() {
    this.server.closeAllConnections()
    return new Promise<void>((resolvePromise) => this.server.close(() => resolvePromise()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? '/', 'http://model').pathname
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = toRecord(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
    if (path.endsWith('/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: 100 }))
      return
    }
    assert(path.endsWith('/messages'), `Fake model got an unexpected path: ${path}`)
    const messages = Array.isArray(body.messages) ? body.messages : []
    const record: ModelRequest = {
      index: this.requests.length,
      main: Array.isArray(body.tools) && body.tools.length > 0,
      stream: body.stream === true,
      model: body.model,
      messageCount: messages.length,
      prompt: JSON.stringify(messages),
      lastMessage: JSON.stringify(messages.at(-1) ?? null),
      receivedAt: Date.now(),
      closedEarly: false,
      held: false,
    }
    this.requests.push(record)
    const step: ModelStep = record.main
      ? (this.steps.shift()?.(record) ?? { text: `Default reply ${record.index}.` })
      : { text: 'Steering test chat' }
    record.held = Boolean(step.gate)
    if (!record.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: `msg_${generateId()}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: step.text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      )
      return
    }
    let open = true
    response.on('close', () => {
      if (open) record.closedEarly = true
      open = false
    })
    const event = (data: Record<string, unknown>) => {
      if (open) response.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    event({
      type: 'message_start',
      message: {
        id: `msg_${generateId()}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    })
    event({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
    event({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: step.text },
    })
    if (step.gate) await step.gate.released
    if (!open) return
    event({ type: 'content_block_stop', index: 0 })
    if (step.tool) {
      event({
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: `toolu_${generateId().replaceAll('-', '')}`,
          name: step.tool.name,
          input: {},
        },
      })
      event({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.tool.input) },
      })
      event({ type: 'content_block_stop', index: 1 })
    }
    event({
      type: 'message_delta',
      delta: { stop_reason: step.tool ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    })
    event({ type: 'message_stop' })
    open = false
    response.end()
  }
}

interface WorkerFrame {
  type: string
  seq?: number
  payload: Record<string, unknown>
}

interface WorkerCall {
  method: string
  path: string
  body: Record<string, unknown>
  status?: number
  response?: unknown
  /** SSE frames of a streamed leg, as the worker sent them. */
  frames: WorkerFrame[]
  refused: boolean
}

/**
 * Sits at Sim's `SIM_AGENT_API_URL`, forwards to the real worker, and keeps what crossed. A refused
 * path drops the connection unanswered, which Sim cannot tell from a worker that went away.
 */
class WorkerProxy {
  readonly calls: WorkerCall[] = []
  private readonly refused = new Set<string>()
  private readonly server = createServer((request, response) => this.forward(request, response))

  refuse(path: string) {
    this.refused.add(path)
  }

  allow(path: string) {
    this.refused.delete(path)
  }

  steers(content?: string) {
    return this.calls.filter(
      (call) =>
        call.path === '/api/streams/steer/v2' &&
        (content === undefined || call.body.content === content)
    )
  }

  legsOf(chatId: string) {
    return this.calls.filter(
      (call) => call.path === '/api/mothership' && call.body.chatId === chatId
    )
  }

  listen() {
    return new Promise<void>((resolvePromise, reject) => {
      this.server.once('error', reject)
      this.server.listen(proxyPort, '127.0.0.1', resolvePromise)
    })
  }

  close() {
    this.server.closeAllConnections()
    return new Promise<void>((resolvePromise) => this.server.close(() => resolvePromise()))
  }

  private forward(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', workerUrl)
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks)
      const call: WorkerCall = {
        method: request.method ?? 'GET',
        path: url.pathname,
        body: parseRecord(raw.toString()),
        frames: [],
        refused: this.refused.has(url.pathname),
      }
      this.calls.push(call)
      if (call.refused) {
        response.destroy()
        return
      }
      const upstream = httpRequest(
        url,
        { method: request.method, headers: request.headers },
        (answer) => {
          call.status = answer.statusCode
          response.writeHead(answer.statusCode ?? 502, answer.headers)
          const streaming = String(answer.headers['content-type']).includes('text/event-stream')
          let pending = ''
          const answered: Buffer[] = []
          answer.on('data', (chunk: Buffer) => {
            response.write(chunk)
            if (!streaming) {
              answered.push(chunk)
              return
            }
            pending += chunk.toString()
            const parts = pending.split('\n\n')
            pending = parts.pop() ?? ''
            for (const part of parts) {
              const data = part.split('\n').find((line) => line.startsWith('data: '))
              const frame = data ? parseRecord(data.slice(6)) : {}
              if (typeof frame.type === 'string') {
                call.frames.push({
                  type: frame.type,
                  seq: typeof frame.seq === 'number' ? frame.seq : undefined,
                  payload: toRecord(frame.payload),
                })
              }
            }
          })
          answer.on('end', () => {
            if (!streaming) call.response = parseRecord(Buffer.concat(answered).toString())
            response.end()
          })
          answer.on('error', () => response.destroy())
        }
      )
      upstream.on('error', () => response.destroy())
      response.on('close', () => upstream.destroy())
      upstream.end(raw)
    })
  }
}

function parseRecord(raw: string): Record<string, unknown> {
  try {
    return toRecord(JSON.parse(raw))
  } catch {
    return {}
  }
}

const model = new FakeModel()
const proxy = new WorkerProxy()
let browser: Browser | undefined
let context: BrowserContext | undefined
const uploadedKeys = new Set<string>()

interface BrowserCall {
  body: Record<string, unknown>
  status?: number
  /** Why the browser got no answer: `net::ERR_INTERNET_DISCONNECTED` never left it. */
  failure?: string
}

/** One tab, with what it sent. A tab has its own outgoing journal, so each check starts clean. */
interface Surface {
  page: Page
  turnPosts: BrowserCall[]
  steerPosts: BrowserCall[]
  consoleErrors: string[]
}

const TURN_PATH = '/api/mothership/chat'
const STEER_PATH = '/api/copilot/chat/steer'
const DISMISS_PATH = '/api/copilot/chat/steer/dismiss'
const STEER_WORKER_PATH = '/api/streams/steer/v2'
const DISPOSITION_WORKER_PATH = '/api/streams/steer/v2/disposition'

/**
 * Cuts Sim off from every worker route that could deliver a steering message or say what became of
 * it. With only the steer route cut off, a turn's end still reads that the worker never got the
 * message and sends it on as a turn, which is scenario 13.
 */
function cutSteeringWorker() {
  proxy.refuse(STEER_WORKER_PATH)
  proxy.refuse(DISPOSITION_WORKER_PATH)
}

function reachSteeringWorker() {
  proxy.allow(STEER_WORKER_PATH)
  proxy.allow(DISPOSITION_WORKER_PATH)
}

async function openSurface(): Promise<Surface> {
  assert(context)
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  const surface: Surface = { page, turnPosts: [], steerPosts: [], consoleErrors: [] }
  const logOf = (pathname: string) =>
    pathname === TURN_PATH ? surface.turnPosts : pathname === STEER_PATH ? surface.steerPosts : null
  const sent = new Map<object, BrowserCall>()
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const log = logOf(new URL(request.url()).pathname)
    if (!log) return
    const call: BrowserCall = { body: toRecord(request.postDataJSON()) }
    sent.set(request, call)
    log.push(call)
  })
  page.on('response', (response) => {
    const call = sent.get(response.request())
    if (call) call.status = response.status()
  })
  page.on('requestfailed', (request) => {
    const call = sent.get(request)
    if (call) call.failure = request.failure()?.errorText ?? 'unknown'
  })
  page.on('pageerror', (error) => surface.consoleErrors.push(error.message))
  await page.goto(`${baseUrl.origin}${organizationRoutes(organizationId).home}`, {
    waitUntil: 'domcontentloaded',
    timeout: 300_000,
  })
  await waitForComposer(page)
  return surface
}

/** The composer is on screen and React has hydrated it, so a key press reaches its handlers. */
async function waitForComposer(page: Page) {
  await composer(page).waitFor({ timeout: 300_000 })
  await composer(page).evaluate(
    (element) =>
      new Promise<void>((done) => {
        const check = () => {
          if (Object.keys(element).some((key) => key.startsWith('__reactProps'))) done()
          else setTimeout(check, 100)
        }
        check()
      }),
    undefined,
    { timeout: 300_000 }
  )
}

/** The composer is named by its placeholder, which changes as a chat starts, runs and settles. */
const COMPOSER_NAME = new RegExp(
  `^(${Object.values(CHAT_PLACEHOLDERS).map(escapeRegExp).join('|')})$`
)
const composer = (page: Page) => page.getByRole('textbox', { name: COMPOSER_NAME })
const conversation = (page: Page) => page.getByRole('region', { name: 'Conversation', exact: true })
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop response', exact: true })
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message', exact: true })
const notDelivered = (page: Page) =>
  conversation(page).getByRole('status').filter({ hasText: 'Not delivered' })

/** Every automatic attempt of a message, on its growing delay, has to run out first. */
const NOT_DELIVERED_TIMEOUT_MS = 240_000

/**
 * Starts a turn, steers `steer` into it with the worker's steer and read routes unreachable, and
 * lets the turn finish, so nothing can say what became of it: its reads run out of attempts and it
 * shows as not delivered.
 */
async function undeliveredSteer(surface: Surface, first: string, steer: string, before: string) {
  const { page } = surface
  const gate = createGate()
  const chatId = await startTurn(surface, first, { text: before, gate })
  cutSteeringWorker()
  await send(page, steer)
  await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({ timeout: 2_000 })
  await expect
    .poll(() => surface.steerPosts.find((post) => post.body.content === steer)?.status)
    .toBeGreaterThanOrEqual(500)
  gate.release()
  await expect(stopButton(page)).toHaveCount(0)
  await expect(notDelivered(page)).toBeVisible({ timeout: NOT_DELIVERED_TIMEOUT_MS })
  await assertOneBubble(page, steer)
  assert.equal(model.containing(steer).length, 0, 'The model never got it')
  await expect.poll(async () => (await userRows(chatId, steer)).length).toBe(1)
  return chatId
}

async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

function chatIdOf(page: Page): string {
  const match = /\/chat\/([0-9a-f-]{36})/.exec(page.url())
  assert(match?.[1], `No chat id in ${page.url()}`)
  return match[1]
}

async function waitForChatId(page: Page): Promise<string> {
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 120_000 })
  return chatIdOf(page)
}

/** Sends the first message of a new chat, its model step streaming `step.text`. */
async function startTurn(surface: Surface, text: string, step: ModelStep): Promise<string> {
  model.enqueue(step)
  await send(surface.page, text)
  await model.waitFor(text)
  await expect(conversation(surface.page).getByText(step.text)).toBeVisible()
  if (step.gate) await expect(stopButton(surface.page)).toBeVisible()
  return waitForChatId(surface.page)
}

async function reload(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 300_000 })
  await waitForComposer(page)
}

async function waitForIdle(page: Page) {
  await expect(stopButton(page)).toHaveCount(0)
  await expect(sendButton(page)).toBeVisible()
}

/** Waits for the worker's answer to a steer and returns its disposition. */
async function workerDisposition(content: string): Promise<string> {
  await expect
    .poll(() => proxy.steers(content).find((call) => call.status !== undefined)?.status, {
      message: `worker answer to the steer "${content}"`,
    })
    .toBe(200)
  await expect
    .poll(() => toRecord(proxy.steers(content).at(-1)?.response).status)
    .toEqual(expect.any(String))
  return String(toRecord(proxy.steers(content).at(-1)?.response).status)
}

interface UserRow {
  messageId: string
  seq: number
  content: string
  steering: unknown
  fileAttachments: unknown
}

async function userRows(chatId: string, text?: string): Promise<UserRow[]> {
  const rows = await sql<
    { message_id: string; seq: string | number; content: Record<string, unknown> }[]
  >`select message_id, seq, content from copilot_messages
    where chat_id = ${chatId} and role = 'user' and deleted_at is null order by seq`
  return rows
    .map((row) => ({
      messageId: row.message_id,
      seq: Number(row.seq),
      content: String(row.content.content),
      steering: row.content.steering,
      fileAttachments: row.content.fileAttachments,
    }))
    .filter((row) => text === undefined || row.content === text)
}

async function steeringBlocksOf(chatId: string): Promise<string[]> {
  const rows = await sql<{ content: Record<string, unknown> }[]>`
    select content from copilot_messages
    where chat_id = ${chatId} and role = 'assistant' and deleted_at is null order by seq`
  const ids: string[] = []
  for (const row of rows) {
    const blocks = Array.isArray(row.content.contentBlocks) ? row.content.contentBlocks : []
    for (const block of blocks) {
      const steering = toRecord(toRecord(block).steering)
      if (toRecord(block).type === 'steering' && typeof steering.steeringId === 'string')
        ids.push(steering.steeringId)
    }
  }
  return ids
}

async function workerSteering(chatId: string) {
  return workerSql<
    {
      steering_id: string | null
      stream_id: string
      consumed: boolean
      event_seq: string | null
      content: string
    }[]
  >`select s.steering_id, s.stream_id, s.consumed_at is not null as consumed, s.event_seq, s.content
    from worker.steering s join worker.runs r on r.id = s.stream_id
    where r.chat_id = ${chatId} order by s.accepted_order`
}

async function steerRowsFor(chatId: string, steeringId: string) {
  return (await workerSteering(chatId)).filter((entry) => entry.steering_id === steeringId)
}

async function workerRuns(chatId: string) {
  return workerSql<{ id: string; status: string }[]>`
    select id, status from worker.runs where chat_id = ${chatId} order by created_at`
}

/** What the server, not the browser, says it started under a turn's id. */
async function serverAdmissions(chatId: string, messageId: string) {
  const [simRuns] = await sql<{ count: string }[]>`
    select count(*) from copilot_runs where chat_id = ${chatId} and stream_id = ${messageId}`
  return {
    simRuns: Number(simRuns?.count),
    workerStarts: proxy
      .legsOf(chatId)
      .filter((call) => call.body.messageId === messageId && call.status === 200).length,
  }
}

/** The message's bubble is on screen exactly once. */
async function assertOneBubble(page: Page, text: string) {
  await expect(conversation(page).getByText(text, { exact: true })).toHaveCount(1)
}

/**
 * The given texts are on screen, top to bottom in this order. Positions are re-read until every
 * text has one, since a re-render (after a reload or reconnect) can replace a node between finding
 * it and measuring it.
 */
async function assertOrder(page: Page, texts: string[]) {
  let positions: number[] = []
  await expect
    .poll(
      async () => {
        positions = []
        for (const text of texts) {
          const box = await conversation(page).getByText(text).first().boundingBox()
          if (!box) return false
          positions.push(box.y)
        }
        return true
      },
      { message: `Every one of ${texts.map((text) => `"${text}"`).join(', ')} is on screen` }
    )
    .toBe(true)
  for (let index = 1; index < positions.length; index++) {
    assert(
      (positions[index - 1] ?? 0) < (positions[index] ?? 0),
      `Expected "${texts[index - 1]}" above "${texts[index]}": ${positions.join(', ')}`
    )
  }
}

/** Every model request holding the text holds it once, and at least one does. */
function assertModelSawOnce(text: string): ModelRequest[] {
  const requests = model.containing(text)
  assert(requests.length > 0, `The model never received "${text}"`)
  for (const request of requests) {
    assert.equal(
      occurrences(request.prompt, text),
      1,
      `Model request ${request.index} holds "${text}" more than once`
    )
  }
  return requests
}

/** It went out as one turn of its own: one row, cleared of steering, one post, one model receipt. */
async function assertDeliveredAsTurn(surface: Surface, chatId: string, text: string) {
  await assertOneBubble(surface.page, text)
  await expect.poll(async () => (await userRows(chatId, text)).length).toBe(1)
  const [row] = await userRows(chatId, text)
  assert(row)
  await expect
    .poll(async () => (await userRows(chatId, text))[0]?.steering ?? null, {
      message: 'the row of a message sent as a turn keeps no steering marker',
    })
    .toBeNull()
  const posts = surface.turnPosts.filter((post) => post.body.message === text)
  for (const post of posts) assert.equal(post.body.userMessageId, row.messageId)
  assert.equal(
    posts.filter((post) => post.status === 200).length,
    1,
    `Expected the browser to see one admitted turn for "${text}"`
  )
  const admitted = await serverAdmissions(chatId, row.messageId)
  assert.deepEqual(
    { simRuns: admitted.simRuns, workerStarts: admitted.workerStarts },
    { simRuns: 1, workerStarts: 1 },
    `Expected the server to admit one turn for "${text}"`
  )
  const receipts = assertModelSawOnce(text)
  assert.equal(receipts.length, 1, `Expected one model receipt of "${text}"`)
  const runs = await workerRuns(chatId)
  assert(
    runs.some((run) => run.id === row.messageId),
    'The worker runs the turn under the message id'
  )
  return row
}

/** It stayed in the running turn: one row, its applied marker, its worker receipt, no turn post. */
async function assertAppliedAsSteer(surface: Surface, chatId: string, text: string) {
  await assertOneBubble(surface.page, text)
  const rows = await userRows(chatId, text)
  assert.equal(rows.length, 1, `Expected one row for "${text}"`)
  const [row] = rows
  assert(row)
  assert(row.steering, 'A steered message keeps its steering marker')
  await expect
    .poll(async () => (await steeringBlocksOf(chatId)).filter((id) => id === row.messageId).length)
    .toBe(1)
  const receipt = (await workerSteering(chatId)).filter(
    (entry) => entry.steering_id === row.messageId
  )
  assert.equal(receipt.length, 1, 'The worker holds one steering row for it')
  assert(receipt[0]?.consumed && receipt[0].event_seq !== null, 'The worker applied it')
  assert.equal(surface.turnPosts.filter((post) => post.body.message === text).length, 0)
  assertModelSawOnce(text)
  return row
}

function assertOneCompleteTerminal(chatId: string, streamId: string) {
  const legs = proxy.legsOf(chatId).filter((call) => call.body.messageId === streamId)
  assert(legs.length > 0, 'The worker streamed this run')
  const terminals = legs.flatMap((leg) => leg.frames).filter((frame) => frame.type === 'complete')
  assert.equal(terminals.length, 1, 'One terminal frame')
  assert.equal(terminals[0]?.payload.status, 'complete')
  return legs.flatMap((leg) => leg.frames)
}

interface Scenario {
  id: string
  name: string
  run: (surface: Surface, evidence: Record<string, unknown>) => Promise<void>
}

const SIM_CLI_HELP = { name: 'sim_cli', input: { args: ['help'] } }

const scenarios: Scenario[] = [
  {
    id: '1',
    name: 'steer lands: appears at once, reaches the next model request, shows once, survives reload',
    run: async ({ page, turnPosts, steerPosts }, evidence) => {
      const first = 'S1 find the launch market'
      const steer = 'S1 focus on enterprise teams'
      const before = 'S1-before-the-steer'
      const after = 'S1-after-the-steer'
      const gate = createGate()
      const chatId = await startTurn({ page, turnPosts, steerPosts, consoleErrors: [] }, first, {
        text: before,
        gate,
        tool: SIM_CLI_HELP,
      })
      model.enqueue({ text: after })
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      evidence.disposition = await workerDisposition(steer)
      assert.equal(evidence.disposition, 'queued')
      await expect.poll(async () => (await userRows(chatId, steer)).length).toBe(1)
      assert.equal(model.containing(steer).length, 0, 'The held step has not seen the steer')
      gate.release()
      const next = await model.waitFor(steer)
      assert(next.lastMessage.includes(steer), 'The next request ends with the steer')
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      await assertOrder(page, [first, before, steer, after])
      const surface = { page, turnPosts, steerPosts, consoleErrors: [] }
      const row = await assertAppliedAsSteer(surface, chatId, steer)
      assert.equal(steerPosts.filter((post) => post.body.content === steer).length, 1)
      assertOneCompleteTerminal(chatId, String(turnPosts[0]?.body.userMessageId))
      await reload(page)
      await assertOneBubble(page, steer)
      await assertOrder(page, [first, before, steer, after])
      const rows = await userRows(chatId)
      assert.deepEqual(
        rows.map((candidate) => candidate.content),
        [first, steer]
      )
      assert.equal(rows[1]?.messageId, row.messageId)
    },
  },
  {
    id: '2',
    name: 'late steer: a steer during the final model step continues the same run',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S2 summarize the findings'
      const steer = 'S2 also mention pricing'
      const final = 'S2-what-would-have-been-final'
      const after = 'S2-continued-with-pricing'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: final, gate })
      model.enqueue({ text: after })
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      assert.equal(await workerDisposition(steer), 'queued')
      gate.release()
      await model.waitFor(steer)
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      await assertAppliedAsSteer(surface, chatId, steer)
      const streamId = String(surface.turnPosts[0]?.body.userMessageId)
      const frames = assertOneCompleteTerminal(chatId, streamId)
      const applied = frames.findIndex(
        (frame) => frame.type === 'run' && frame.payload.kind === 'steering_applied'
      )
      const terminal = frames.findIndex((frame) => frame.type === 'complete')
      assert(applied >= 0 && applied < terminal, 'steering_applied precedes the terminal frame')
      assert.equal(frames.at(-1)?.type, 'complete', 'Nothing follows the terminal frame')
      const runs = await workerRuns(chatId)
      evidence.runs = runs.map((run) => run.status)
      assert.deepEqual(evidence.runs, ['complete'], 'One run, and it completed')
      assert.equal(surface.turnPosts.length, 1, 'No second turn')
      assert.equal(model.containing(first).length, 2, 'Two model steps in the one run')
      await assertOrder(page, [first, final, steer, after])
    },
  },
  {
    id: '3',
    name: 'turn ended first (not_applied): goes out as exactly one new turn under its steering id',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S3 quick question'
      const steer = 'S3 one more thing'
      const before = 'S3-the-turn-finished'
      const after = 'S3-answered-as-its-own-turn'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      const streamId = String(surface.turnPosts[0]?.body.userMessageId)
      /* The steer leaves the browser now but reaches Sim only after the run has closed, which is the
         race: the worker cannot apply it, and says so. */
      const steerArrived = createGate()
      const letSteerGo = createGate()
      await page.route(`**${STEER_PATH}`, async (route) => {
        steerArrived.release()
        await letSteerGo.released
        await route.continue()
      })
      model.enqueue({ text: after })
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      await steerArrived.released
      gate.release()
      await expect.poll(async () => (await workerRuns(chatId))[0]?.status).toBe('complete')
      assert.equal(model.containing(steer).length, 0, 'The finished run never saw it')
      letSteerGo.release()
      evidence.disposition = await workerDisposition(steer)
      assert.equal(evidence.disposition, 'not_applied')
      await model.waitFor(steer)
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      const row = await assertDeliveredAsTurn(surface, chatId, steer)
      const steerPost = surface.steerPosts.find((post) => post.body.content === steer)
      assert.equal(steerPost?.body.steeringId, row.messageId, 'The turn keeps its steering id')
      assert.equal(steerPost?.body.streamId, streamId)
      const turn = surface.turnPosts.find((post) => post.body.message === steer)
      assert.equal(turn?.body.steeringFallback, true)
      assert.deepEqual(
        (await userRows(chatId)).map((candidate) => candidate.content),
        [first, steer]
      )
      assert.equal(model.containing(steer).length, 1, 'One model receipt')
      await assertOrder(page, [first, before, steer, after])
      await reload(page)
      await assertOneBubble(page, steer)
      await assertOrder(page, [first, before, steer, after])
      await page.unroute(`**${STEER_PATH}`)
    },
  },
  {
    id: '4',
    name: 'stop: a steer pending at Stop goes out as the next turn, once',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S4 write a long report'
      const steer = 'S4 actually keep it short'
      const before = 'S4-streaming-when-stopped'
      const after = 'S4-short-report'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      const held = await model.waitFor(first)
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      assert.equal(await workerDisposition(steer), 'queued')
      model.enqueue({ text: after })
      await stopButton(page).click()
      await expect
        .poll(() => held.closedEarly, { message: 'Stop aborts the model step' })
        .toBe(true)
      await model.waitFor(steer)
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      await assertDeliveredAsTurn(surface, chatId, steer)
      evidence.runs = (await workerRuns(chatId)).map((run) => run.status)
      assert.deepEqual(
        (await userRows(chatId)).map((candidate) => candidate.content),
        [first, steer]
      )
      gate.release()
      await reload(page)
      await assertOneBubble(page, steer)
    },
  },
  {
    id: '5a',
    name: 'reload mid-steer: a steer still unsent and a message behind it are each delivered once',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S5a gather the data'
      const steer = 'S5a include last quarter'
      const follower = 'S5a and the quarter before'
      const before = 'S5a-before-the-reload'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      /* Never reaches Sim: the reload cancels it, as a tab closing would. */
      const steerArrived = createGate()
      await page.route(`**${STEER_PATH}`, async () => {
        steerArrived.release()
        await sleep(600_000)
      })
      await send(page, steer)
      await steerArrived.released
      await send(page, follower)
      await expect(conversation(page).getByText(follower, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      const journal = await page.evaluate(() =>
        window.sessionStorage.getItem('mothership-outgoing:v1')
      )
      evidence.journalBeforeReload = journal
      assert(journal?.includes(steer) && journal.includes(follower), 'Both are journaled')
      assert.equal((await userRows(chatId, steer)).length, 0, 'Sim has not seen the steer')
      await page.unrouteAll({ behavior: 'ignoreErrors' })
      await reload(page)
      await assertOneBubble(page, steer)
      await assertOneBubble(page, follower)
      gate.release()
      await model.waitFor(steer)
      await model.waitFor(follower)
      await waitForIdle(page)
      await assertOneBubble(page, steer)
      await assertOneBubble(page, follower)
      await expect.poll(async () => (await userRows(chatId, steer)).length).toBe(1)
      await expect.poll(async () => (await userRows(chatId, follower)).length).toBe(1)
      assertModelSawOnce(steer)
      assertModelSawOnce(follower)
      const rows = await userRows(chatId)
      assert.deepEqual(
        rows.map((candidate) => candidate.content),
        [first, steer, follower],
        'Delivered in the order written'
      )
      await reload(page)
      await assertOneBubble(page, steer)
      await assertOneBubble(page, follower)
      await assertOrder(page, [first, steer, follower])
    },
  },
  {
    id: '5b',
    name: 'reload mid-steer: a steer the worker holds is applied once by the running turn',
    run: async (surface, evidence) => {
      const { page } = surface
      const startedMs = Date.now()
      const mark = (name: string) => {
        evidence[name] = Date.now() - startedMs
      }
      const first = 'S5b gather the data'
      const steer = 'S5b include last quarter'
      const before = 'S5b-before-the-reload'
      const after = 'S5b-after-the-reload'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      await send(page, steer)
      assert.equal(await workerDisposition(steer), 'queued')
      model.enqueue({ text: after })
      mark('reloadStartMs')
      await reload(page)
      mark('reloadedMs')
      await assertOneBubble(page, steer)
      await expect(stopButton(page)).toBeVisible()
      mark('reattachedMs')
      gate.release()
      await model.waitFor(steer)
      mark('modelReceivedSteerMs')
      await expect(conversation(page).getByText(after)).toBeVisible()
      mark('afterTextVisibleMs')
      await waitForIdle(page)
      mark('idleMs')
      await assertAppliedAsSteer(surface, chatId, steer)
      assert.equal(surface.turnPosts.filter((post) => post.body.message === steer).length, 0)
      await assertOrder(page, [first, before, steer, after])
      assert.deepEqual(
        (await userRows(chatId)).map((candidate) => candidate.content),
        [first, steer]
      )
      await reload(page)
      await assertOneBubble(page, steer)
      await assertOrder(page, [first, before, steer, after])
    },
  },
  {
    id: '6a',
    name: 'offline: a send made offline goes out once on coming back',
    run: async (surface, evidence) => {
      const { page } = surface
      assert(context)
      const first = 'S6a start the chat'
      const message = 'S6a sent while offline'
      const reply = 'S6a-reply-after-coming-back'
      const chatId = await startTurn(surface, first, { text: 'S6a-first-reply' })
      await waitForIdle(page)
      await context.setOffline(true)
      model.enqueue({ text: reply })
      await send(page, message)
      await expect(conversation(page).getByText(message, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      // A negative window: nothing signals that an offline send was held back, so the check gives
      // it time to (wrongly) reach the model before asserting it did not.
      await sleep(5_000)
      assert.equal(model.containing(message).length, 0, 'Nothing reached the model offline')
      await context.setOffline(false)
      await model.waitFor(message)
      await expect(conversation(page).getByText(reply)).toBeVisible()
      await waitForIdle(page)
      const row = await assertDeliveredAsTurn(surface, chatId, message)
      const attempts = surface.turnPosts.filter((post) => post.body.message === message)
      evidence.attempts = attempts.map(({ status, failure }) => ({ status, failure }))
      evidence.admissions = await serverAdmissions(chatId, row.messageId)
      for (const attempt of attempts) {
        if (attempt.status !== 200) {
          assert(
            attempt.failure?.includes('ERR_INTERNET_DISCONNECTED'),
            `An unanswered attempt must never have left the browser: ${attempt.failure}`
          )
        }
      }
      assert.equal(proxy.steers(message).length, 0, 'An idle chat sends no steer')
      await reload(page)
      await assertOneBubble(page, message)
    },
  },
  {
    id: '6b',
    name: 'offline: a steer made offline during a running turn is delivered once',
    run: async (surface) => {
      const { page } = surface
      assert(context)
      const first = 'S6b start the turn'
      const steer = 'S6b steered while offline'
      const before = 'S6b-streaming'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      await context.setOffline(true)
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      await sleep(3_000)
      assert.equal(proxy.steers(steer).length, 0, 'Nothing reached the worker offline')
      await context.setOffline(false)
      gate.release()
      await model.waitFor(steer)
      await waitForIdle(page)
      await assertOneBubble(page, steer)
      await expect.poll(async () => (await userRows(chatId, steer)).length).toBe(1)
      assertModelSawOnce(steer)
      assert.deepEqual(
        (await userRows(chatId)).map((candidate) => candidate.content),
        [first, steer]
      )
      await reload(page)
      await assertOneBubble(page, steer)
    },
  },
  {
    id: '6c',
    name: 'offline: a send the server admitted before the connection dropped stays one turn',
    run: async (surface, evidence) => {
      const { page } = surface
      assert(context)
      const first = 'S6c start the chat'
      const message = 'S6c admitted then the connection dropped'
      const held = 'S6c-streaming-through-the-drop'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: 'S6c-first-reply' })
      await waitForIdle(page)
      model.enqueue({ text: held, gate })
      await send(page, message)
      await model.waitFor(message)
      await expect(conversation(page).getByText(held)).toBeVisible()
      await context.setOffline(true)
      await sleep(3_000)
      await context.setOffline(false)
      gate.release()
      await waitForIdle(page)
      const [row] = await userRows(chatId, message)
      assert(row)
      await assertOneBubble(page, message)
      assert.equal((await userRows(chatId, message)).length, 1)
      const receipts = assertModelSawOnce(message)
      assert.equal(receipts.length, 1, 'One model receipt')
      const admissions = await serverAdmissions(chatId, row.messageId)
      evidence.admissions = admissions
      evidence.attempts = surface.turnPosts
        .filter((post) => post.body.message === message)
        .map(({ status, failure }) => ({ status, failure }))
      assert.deepEqual(admissions, { simRuns: 1, workerStarts: 1 })
      assert.equal(proxy.steers(message).length, 0, 'A send never steers itself')
      assert.equal((await steerRowsFor(chatId, row.messageId)).length, 0, 'No steering row')
      await reload(page)
      await assertOneBubble(page, message)
      await expect(notDelivered(page)).toHaveCount(0)
    },
  },
  {
    id: '7',
    name: 'file attachment steered: the model receives the file and reads its content',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S7 review the notes'
      const steer = 'S7 use the attached notes'
      const before = 'S7-streaming'
      const after = 'S7-read-the-file'
      const sentinel = `S7-sentinel-${generateShortId()}`
      const filename = `s7-notes-${generateShortId(8)}.txt`
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate })
      await attachFile(page, filename, `Market notes: ${sentinel}\n`)
      model.enqueue(
        (request) => {
          const reference = /uploads\/[^"\\ ]+/.exec(request.lastMessage)?.[0]
          assert(reference, 'The steer names its upload')
          return {
            text: 'S7-reading-the-upload',
            tool: { name: 'sim_cli', input: { args: ['files', 'read', reference] } },
          }
        },
        { text: after }
      )
      await send(page, steer)
      await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      assert.equal(await workerDisposition(steer), 'queued')
      const steerCall = proxy.steers(steer).at(-1)
      assert(
        JSON.stringify(steerCall?.body.context).includes(filename),
        'The worker got the file as a context'
      )
      gate.release()
      const steered = await model.waitFor(steer)
      assert(steered.lastMessage.includes(filename), 'The steer carries the file to the model')
      await model.waitFor(sentinel)
      const reading = model.containing(sentinel)[0]
      evidence.toolResult = reading?.lastMessage.slice(0, 400)
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      await assertAppliedAsSteer(surface, chatId, steer)
      const [row] = await userRows(chatId, steer)
      assert(Array.isArray(row?.fileAttachments) && row.fileAttachments.length === 1)
      assert.equal(toRecord(row.fileAttachments[0]).filename, filename)
      uploadedKeys.add(String(toRecord(row.fileAttachments[0]).key))
      const steerPost = surface.steerPosts.find((post) => post.body.content === steer)
      assert(Array.isArray(steerPost?.body.fileAttachments))
      await reload(page)
      await assertOneBubble(page, steer)
      await expect(
        conversation(page)
          .getByRole('button', { name: `Preview ${filename}`, exact: true })
          .first()
      ).toBeVisible()
    },
  },
  {
    id: '8',
    name: 'ordinary turns unchanged: first message, follow-up and a file send make no steering calls',
    run: async (surface, evidence) => {
      const { page } = surface
      const steersBefore = proxy.steers().length
      const first = 'S8 plain first message'
      const followUp = 'S8 plain follow up'
      const withFile = 'S8 here is a file'
      const sentinel = `S8-sentinel-${generateShortId()}`
      const filename = `s8-notes-${generateShortId(8)}.txt`
      const chatId = await startTurn(surface, first, { text: 'S8-first-reply' })
      await waitForIdle(page)
      model.enqueue({ text: 'S8-follow-up-reply' })
      await send(page, followUp)
      await expect(conversation(page).getByText('S8-follow-up-reply')).toBeVisible()
      await waitForIdle(page)
      await attachFile(page, filename, `Notes: ${sentinel}\n`)
      model.enqueue(
        (request) => {
          const reference = /uploads\/[^"\\ ]+/.exec(request.lastMessage)?.[0]
          assert(reference, 'The turn names its upload')
          return {
            text: 'S8-reading-the-upload',
            tool: { name: 'sim_cli', input: { args: ['files', 'read', reference] } },
          }
        },
        { text: 'S8-file-reply' }
      )
      await send(page, withFile)
      await expect(conversation(page).getByText('S8-file-reply')).toBeVisible()
      await waitForIdle(page)
      await model.waitFor(sentinel)
      for (const text of [first, followUp, withFile]) await assertOneBubble(page, text)
      const rows = await userRows(chatId)
      assert.deepEqual(
        rows.map((row) => row.content),
        [first, followUp, withFile]
      )
      for (const row of rows) assert.equal(row.steering ?? null, null, 'No steering marker')
      assert.equal(surface.steerPosts.length, 0, 'The browser made no steering call')
      assert.equal(proxy.steers().length, steersBefore, 'The worker got no steering call')
      assert.equal((await workerSteering(chatId)).length, 0, 'The worker holds no steering row')
      assert.deepEqual(
        surface.turnPosts.map((post) => post.body.message),
        [first, followUp, withFile]
      )
      for (const post of surface.turnPosts) assert.equal(post.body.steeringFallback ?? false, false)
      for (const text of [first, followUp, withFile]) assertModelSawOnce(text)
      const runs = await workerRuns(chatId)
      evidence.runs = runs.map((run) => run.status)
      assert.deepEqual(evidence.runs, ['complete', 'complete', 'complete'])
      assert(Array.isArray(rows[2]?.fileAttachments) && rows[2].fileAttachments.length === 1)
      uploadedKeys.add(String(toRecord(rows[2].fileAttachments[0]).key))
    },
  },
  {
    id: '9',
    name: 'two rapid steers: both applied in order, neither duplicated',
    run: async (surface) => {
      const { page } = surface
      const first = 'S9 draft the email'
      const steerOne = 'S9 address it to Dana'
      const steerTwo = 'S9 and sign it from Sam'
      const before = 'S9-before-both'
      const after = 'S9-after-both'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: before, gate, tool: SIM_CLI_HELP })
      model.enqueue({ text: after })
      await send(page, steerOne)
      await send(page, steerTwo)
      await expect(conversation(page).getByText(steerOne, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      await expect(conversation(page).getByText(steerTwo, { exact: true })).toBeVisible({
        timeout: 2_000,
      })
      assert.equal(await workerDisposition(steerOne), 'queued')
      assert.equal(await workerDisposition(steerTwo), 'queued')
      gate.release()
      const next = await model.waitFor(steerOne)
      assert(next.prompt.includes(steerTwo), 'The next model step gets both')
      assert(
        next.prompt.indexOf(steerOne) < next.prompt.indexOf(steerTwo),
        'The model reads them in the order written'
      )
      await expect(conversation(page).getByText(after)).toBeVisible()
      await waitForIdle(page)
      const rowOne = await assertAppliedAsSteer(surface, chatId, steerOne)
      const rowTwo = await assertAppliedAsSteer(surface, chatId, steerTwo)
      assert(rowOne.seq < rowTwo.seq, 'Rows keep the order written')
      assert.deepEqual(
        (await steeringBlocksOf(chatId)).filter((id) =>
          [rowOne.messageId, rowTwo.messageId].includes(id)
        ),
        [rowOne.messageId, rowTwo.messageId]
      )
      assert.equal(surface.turnPosts.length, 1, 'No extra turn')
      await assertOrder(page, [first, before, steerOne, steerTwo, after])
      await reload(page)
      await assertOneBubble(page, steerOne)
      await assertOneBubble(page, steerTwo)
      await assertOrder(page, [first, before, steerOne, steerTwo, after])
    },
  },
  {
    id: '10',
    name: 'status line: an undeliverable message shows "Not delivered", and Retry delivers it once',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S10 start the turn'
      const steer = 'S10 the worker cannot be reached for this'
      const reply = 'S10-delivered-after-retry'
      try {
        const chatId = await undeliveredSteer(surface, first, steer, 'S10-before')
        evidence.refusedSteerCalls = proxy.steers(steer).length
        const shot = `${reportPath.replace(/\.json$/, '')}-not-delivered.png`
        await page.screenshot({ path: shot })
        evidence.screenshot = shot
        model.enqueue({ text: reply })
        reachSteeringWorker()
        await notDelivered(page).getByRole('button', { name: 'Retry', exact: true }).click()
        await model.waitFor(steer)
        await expect(conversation(page).getByText(reply)).toBeVisible()
        await waitForIdle(page)
        await expect(notDelivered(page)).toHaveCount(0)
        await assertDeliveredAsTurn(surface, chatId, steer)
        assert.deepEqual(
          (await userRows(chatId)).map((candidate) => candidate.content),
          [first, steer]
        )
        await reload(page)
        await assertOneBubble(page, steer)
        await expect(notDelivered(page)).toHaveCount(0)
      } finally {
        reachSteeringWorker()
      }
    },
  },
  {
    id: '11',
    name: 'dismiss: a Not delivered message is removed, stays gone after reload, and blocks nothing',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S11 start the turn'
      const steer = 'S11 the user gives up on this one'
      const later = 'S11 a later message'
      const reply = 'S11-later-reply'
      const dismiss = () =>
        Promise.all([
          page.waitForResponse((response) => new URL(response.url()).pathname === DISMISS_PATH),
          notDelivered(page).getByRole('button', { name: 'Dismiss', exact: true }).click(),
        ])
      try {
        const chatId = await undeliveredSteer(surface, first, steer, 'S11-before')
        /* With no answer from the worker nothing is known about it, so it stays. */
        const [unanswered] = await dismiss()
        evidence.dismissWithNoWorker = unanswered.status()
        assert(unanswered.status() >= 500, 'The worker could not answer')
        await expect(notDelivered(page)).toBeVisible()
        await assertOneBubble(page, steer)
        assert.equal((await userRows(chatId, steer)).length, 1, 'It keeps its record')

        reachSteeringWorker()
        const [answered] = await dismiss()
        assert.equal(answered.status(), 200)
        evidence.dismissOutcome = await answered.json()
        assert.equal(toRecord(evidence.dismissOutcome).status, 'dismissed')
        await expect(page.getByText(steer, { exact: true })).toHaveCount(0)
        await expect(notDelivered(page)).toHaveCount(0)
        assert.equal((await userRows(chatId, steer)).length, 0, 'Its record is gone')
        const journal = await page.evaluate(() =>
          window.sessionStorage.getItem('mothership-outgoing:v1')
        )
        assert(!journal?.includes(steer), 'It left the journal')

        await reload(page)
        await expect(stopButton(page)).toHaveCount(0)
        await expect(conversation(page).getByText('S11-before')).toBeVisible()
        await expect(page.getByText(steer, { exact: true })).toHaveCount(0)
        await expect(notDelivered(page)).toHaveCount(0)
        assert.equal((await userRows(chatId, steer)).length, 0, 'Reload does not restore it')

        model.enqueue({ text: reply })
        await send(page, later)
        await model.waitFor(later)
        await expect(conversation(page).getByText(reply)).toBeVisible()
        await waitForIdle(page)
        await assertDeliveredAsTurn(surface, chatId, later)
        assert.equal(model.containing(steer).length, 0, 'The model never gets a dismissed message')
        assert.equal(surface.turnPosts.filter((post) => post.body.message === steer).length, 0)
        assert.deepEqual(
          (await userRows(chatId)).map((candidate) => candidate.content),
          [first, later]
        )
        await reload(page)
        await expect(page.getByText(steer, { exact: true })).toHaveCount(0)
        await assertOneBubble(page, later)
      } finally {
        reachSteeringWorker()
      }
    },
  },
  {
    id: '12',
    name: 'a Not delivered message blocks no later send, and its Retry still delivers it once',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S12 start the turn'
      const failed = 'S12 this one stays undelivered for now'
      const later = 'S12 a later message goes straight out'
      const laterReply = 'S12-later-reply'
      const retryReply = 'S12-retry-reply'
      try {
        const chatId = await undeliveredSteer(surface, first, failed, 'S12-before')
        model.enqueue({ text: laterReply })
        await send(page, later)
        await model.waitFor(later)
        await expect(conversation(page).getByText(laterReply)).toBeVisible()
        await waitForIdle(page)
        await assertDeliveredAsTurn(surface, chatId, later)
        assert.equal(model.containing(failed).length, 0, 'It does not go out with the later send')
        assert.equal(surface.turnPosts.filter((post) => post.body.message === failed).length, 0)
        await expect(notDelivered(page)).toBeVisible()
        await assertOneBubble(page, failed)
        const shot = `${reportPath.replace(/\.json$/, '')}-failed-with-later-send.png`
        await page.screenshot({ path: shot })
        evidence.screenshot = shot

        await reload(page)
        await expect(notDelivered(page)).toBeVisible({ timeout: NOT_DELIVERED_TIMEOUT_MS })
        await assertOneBubble(page, failed)
        await assertOneBubble(page, later)
        assert.equal(model.containing(failed).length, 0, 'A reload does not send it')

        model.enqueue({ text: retryReply })
        reachSteeringWorker()
        await notDelivered(page).getByRole('button', { name: 'Retry', exact: true }).click()
        await model.waitFor(failed)
        await expect(conversation(page).getByText(retryReply)).toBeVisible()
        await waitForIdle(page)
        await expect(notDelivered(page)).toHaveCount(0)
        await assertDeliveredAsTurn(surface, chatId, failed)
        assert.deepEqual(
          (await userRows(chatId)).map((candidate) => candidate.content),
          [first, later, failed],
          'A retried message takes its place as the latest turn'
        )
        await assertOneBubble(page, later)
        await reload(page)
        await assertOneBubble(page, failed)
        await assertOneBubble(page, later)
        await expect(notDelivered(page)).toHaveCount(0)
      } finally {
        reachSteeringWorker()
      }
    },
  },
  {
    id: '13',
    name: 'unreachable steer: the read says the run never got it, so it goes out once as the next turn',
    run: async (surface, evidence) => {
      const { page } = surface
      const first = 'S13 start the turn'
      const steer = 'S13 the steer never reaches the worker'
      const after = 'S13-answered-as-its-own-turn'
      const gate = createGate()
      const chatId = await startTurn(surface, first, { text: 'S13-before', gate })
      try {
        proxy.refuse(STEER_WORKER_PATH)
        model.enqueue({ text: after })
        await send(page, steer)
        await expect(conversation(page).getByText(steer, { exact: true })).toBeVisible({
          timeout: 2_000,
        })
        await expect
          .poll(() => surface.steerPosts.find((post) => post.body.content === steer)?.status)
          .toBeGreaterThanOrEqual(500)
        gate.release()
        await model.waitFor(steer)
        await expect(conversation(page).getByText(after)).toBeVisible()
        await waitForIdle(page)
        await expect(notDelivered(page)).toHaveCount(0)
        await assertDeliveredAsTurn(surface, chatId, steer)
        const reads = proxy.calls.filter(
          (call) => call.path === DISPOSITION_WORKER_PATH && !call.refused
        )
        evidence.dispositionReads = reads.map((call) => toRecord(call.response).status)
        assert(
          reads.some((call) => toRecord(call.response).status === 'not_applied'),
          'The worker read it as never applied'
        )
        assert(
          proxy.steers(steer).every((call) => call.refused),
          'No steer of it reached the worker'
        )
        assert.equal(
          surface.turnPosts.find((post) => post.body.message === steer)?.body.steeringFallback,
          true
        )
        assert.deepEqual(
          (await userRows(chatId)).map((candidate) => candidate.content),
          [first, steer]
        )
        await reload(page)
        await assertOneBubble(page, steer)
        await expect(notDelivered(page)).toHaveCount(0)
      } finally {
        reachSteeringWorker()
      }
    },
  },
]

async function attachFile(page: Page, filename: string, content: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach file', exact: true }).click()
  await (await chooser).setFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  })
  /* Its tile describes it as uploading until the upload lands, and a draft holding it cannot send. */
  const tile = page.getByRole('button', { name: `Preview ${filename}`, exact: true })
  await expect(tile).toBeVisible()
  await expect(tile).not.toHaveAttribute('aria-description', 'Uploading', { timeout: 120_000 })
}

async function seed() {
  await sql.begin(async (tx) => {
    const email = `${userId}@chat-steering.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, 'Chat steering fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into organization (id, name, slug) values (${organizationId}, 'Chat steering organization', ${organizationId})`
    await tx`insert into member (id, user_id, organization_id, role) values (${generateId()}, ${userId}, ${organizationId}, 'owner')`
    await tx`insert into project (id, name, organization_id, owner_id) values (${workspaceId}, 'Chat steering fixture', ${organizationId}, ${userId})`
    await tx`insert into workspace (id, project_id, name, owner_id, organization_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Chat steering fixture', ${userId}, ${organizationId}, ${userId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${userId}, now() + interval '4 hours', now(), now())`
  })
}

/**
 * `next dev` compiles a route on its first request, which can outlast the client's bound on a
 * steer. A plain turn and a touch of each control route compile them before any check is timed.
 */
async function warmUp() {
  assert(context)
  for (const path of [STEER_PATH, '/api/mothership/chat/stop', '/api/copilot/chat/abort']) {
    await context.request.post(`${baseUrl.origin}${path}`, { data: {}, timeout: 300_000 })
  }
  const surface = await openSurface()
  model.enqueue({ text: 'Warm-up reply.' })
  await send(surface.page, 'Warm-up message')
  await expect(conversation(surface.page).getByText('Warm-up reply.')).toBeVisible({
    timeout: 120_000,
  })
  await waitForIdle(surface.page)
  const chatId = await waitForChatId(surface.page)
  await context.request.get(`${baseUrl.origin}/api/mothership/chats/${chatId}`, {
    timeout: 300_000,
  })
  await surface.page.close()
}

async function runScenario(scenario: Scenario) {
  const name = `${scenario.id}: ${scenario.name}`
  if (only && !only.includes(scenario.id)) {
    checks.push({ name, status: 'skipped', durationMs: 0 })
    return
  }
  const evidence: Record<string, unknown> = {}
  const start = performance.now()
  let surface: Surface | undefined
  try {
    surface = await openSurface()
    await scenario.run(surface, evidence)
    checks.push({
      name,
      status: 'passed',
      durationMs: Math.round(performance.now() - start),
      evidence,
    })
    logger.info('Check passed', { name })
  } catch (error) {
    const message = getErrorMessage(error)
    if (surface) {
      const shot = `${reportPath.replace(/\.json$/, '')}-failure-${scenario.id}.png`
      await surface.page.screenshot({ path: shot }).catch(() => undefined)
      evidence.screenshot = shot
      evidence.dom = await surface.page
        .evaluate(() => document.body.innerText.slice(-2_000))
        .catch(() => undefined)
      evidence.journal = await surface.page
        .evaluate(() => window.sessionStorage.getItem('mothership-outgoing:v1'))
        .catch(() => undefined)
      evidence.turnPosts = surface.turnPosts
      evidence.steerPosts = surface.steerPosts
      evidence.pageErrors = surface.consoleErrors
    }
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - start),
      error: message,
      evidence,
    })
    logger.error('Check failed', { name, error: message })
    process.exitCode = 1
  } finally {
    model.resetScript()
    for (const release of openGates) release()
    openGates.clear()
    await context?.setOffline(false).catch(() => undefined)
    if (surface) await surface.page.close().catch(() => undefined)
  }
}

try {
  await mkdir(dirname(reportPath), { recursive: true })
  await model.listen()
  await proxy.listen()
  await seed()
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, authSecret)}`),
      url: baseUrl.origin,
    },
  ])
  const warmStart = performance.now()
  await warmUp()
  logger.info('Warm-up finished', { durationMs: Math.round(performance.now() - warmStart) })
  for (const scenario of scenarios) await runScenario(scenario)
} catch (error) {
  logger.error('Suite failed', { error: getErrorMessage(error) })
  await context
    ?.pages()[0]
    ?.screenshot({ path: `${reportPath.replace(/\.json$/, '')}-failure-setup.png` })
    .catch(() => undefined)
  checks.push({
    name: 'suite setup',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  for (const key of uploadedKeys) await rm(join(uploadsPath, key), { force: true })
  await model.close()
  await proxy.close()
  await sql.end()
  await workerSql.end()
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        scope:
          'Real browser, real Sim app, real Mothership worker, real Postgres and Redis. Only the model is fake: a local Anthropic-compatible server behind COPILOT_ANTHROPIC_BASE_URL.',
        checks,
        modelRequests: model.requests.map(({ prompt: _prompt, ...request }) => ({
          ...request,
          lastMessage: request.lastMessage.slice(0, 300),
        })),
        workerCalls: proxy.calls.map((call) => ({
          method: call.method,
          path: call.path,
          status: call.status,
          refused: call.refused,
          response: isRecordLike(call.response) ? call.response : undefined,
          steeringId: call.body.steeringId,
          messageId: call.body.messageId,
          terminal: call.frames.filter((frame) => frame.type === 'complete'),
        })),
      },
      null,
      2
    )
  )
}
