import { createHmac } from 'node:crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { toArray } from '@sim/utils/object'
import postgres from 'postgres'

/**
 * A real local Sim app for the desktop E2E suite: the Electron app talks to it through a
 * recording proxy, and Sim talks to a scripted agent standing in for the Mothership worker at
 * `SIM_AGENT_API_URL`. Both sides of the desktop tools are the shipped code; only the model's
 * decisions are scripted.
 *
 * Start Sim (for example `next dev`) with `NEXT_PUBLIC_APP_URL` and `BETTER_AUTH_URL` set to the
 * proxy's origin, `SIM_AGENT_API_URL` set to the agent's, `REDIS_URL`, and
 * `COPILOT_TOOL_PERMISSIONS_ENABLED=true`, then provide the environment `liveSimConfig` reads.
 */
export interface LiveSimConfig {
  /** Where Sim itself listens. */
  upstream: string
  /** The proxy's port: the origin Sim and Electron both use. */
  proxyPort: number
  /** The scripted agent's port. */
  agentPort: number
  databaseUrl: string
  redisUrl: string
  /** Sim's `BETTER_AUTH_SECRET`, to sign the session cookie of a seeded session. */
  authSecret: string
}

/** The live Sim this run was given, or why the suite is skipped. */
export function liveSimConfig(): LiveSimConfig | string {
  const env = process.env
  const missing = [
    'SIM_DESKTOP_E2E_SIM_URL',
    'SIM_DESKTOP_E2E_PROXY_PORT',
    'SIM_DESKTOP_E2E_AGENT_PORT',
    'SIM_DESKTOP_E2E_DATABASE_URL',
    'SIM_DESKTOP_E2E_REDIS_URL',
    'SIM_DESKTOP_E2E_AUTH_SECRET',
  ].filter((name) => !env[name])
  if (missing.length > 0) return `Needs a local Sim app: set ${missing.join(', ')}`
  const databaseUrl = env.SIM_DESKTOP_E2E_DATABASE_URL ?? ''
  if (!/(?:^|[_-])test$/i.test(new URL(databaseUrl).pathname.slice(1)))
    return 'SIM_DESKTOP_E2E_DATABASE_URL must name a dedicated test database'
  return {
    upstream: env.SIM_DESKTOP_E2E_SIM_URL ?? '',
    proxyPort: Number(env.SIM_DESKTOP_E2E_PROXY_PORT),
    agentPort: Number(env.SIM_DESKTOP_E2E_AGENT_PORT),
    databaseUrl,
    redisUrl: env.SIM_DESKTOP_E2E_REDIS_URL ?? '',
    authSecret: env.SIM_DESKTOP_E2E_AUTH_SECRET ?? '',
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

/** One request the proxy saw, from the renderer or Electron's main process. */
interface ProxiedRequest {
  method: string
  path: string
  at: number
  status?: number
  /** When the client gave up on the response before it finished (a reader that let go). */
  clientClosedAt?: number
}

/**
 * A request the proxy holds before it reaches Sim, so a test can act while a tool's request is
 * in flight. A request whose client gave up while held is dropped, never forwarded, as a
 * cancelled request on a real network would be.
 */
class HeldRequest {
  readonly reached: Promise<ProxiedRequest>
  /** Settles once the client gives up on the held request (it cancelled it). */
  readonly abandoned: Promise<void>
  isAbandoned = false
  private reach!: (request: ProxiedRequest) => void
  private abandon!: () => void
  private releaseHeld: (() => void) | undefined
  private released = false

  constructor(
    readonly matches: (method: string, path: string) => boolean,
    /** Deliver the request to Sim on release even if its client gave up, as a late request would arrive. */
    readonly deliverIfAbandoned = false
  ) {
    this.reached = new Promise((resolve) => {
      this.reach = resolve
    })
    this.abandoned = new Promise((resolve) => {
      this.abandon = resolve
    })
  }

  /** Called by the proxy when the matching request arrives; resolves when the test releases it. */
  hold(request: ProxiedRequest, response: ServerResponse): Promise<boolean> {
    response.once('close', () => {
      if (response.writableFinished || this.released) return
      this.isAbandoned = true
      this.abandon()
    })
    this.reach(request)
    return new Promise((resolve) => {
      this.releaseHeld = () => resolve(!this.isAbandoned)
      if (this.released) this.releaseHeld()
    })
  }

  /** The held request, once it arrives; fails if it has not within `timeoutMs`. */
  async arrival(timeoutMs: number, label: string): Promise<ProxiedRequest> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} did not arrive in ${timeoutMs} ms`)),
        timeoutMs
      )
    })
    try {
      return await Promise.race([this.reached, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  release(): void {
    this.released = true
    this.releaseHeld?.()
  }
}

/**
 * The origin Electron and Sim share. It forwards everything to Sim, records each request, can
 * hold one until the test releases it, rewrite an answer or cut the network, and serves one
 * test-only route that installs a seeded session's cookie the way Sim's own sign-in response
 * would.
 */
export class SimProxy {
  readonly requests: ProxiedRequest[] = []
  readonly origin: string
  private readonly server: Server
  private holds: HeldRequest[] = []
  /** Requests a hold is keeping from Sim right now. */
  private readonly heldEntries = new Set<ProxiedRequest>()
  private readonly answerRewrites = new Map<string, (body: Record<string, unknown>) => void>()
  private readonly sockets = new Set<Duplex>()
  /** Every client connection open now, HTTP and upgraded alike. */
  private readonly connections = new Set<Socket>()
  private networkCut = false

  constructor(private readonly config: LiveSimConfig) {
    this.origin = `http://127.0.0.1:${config.proxyPort}`
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(502)
        response.end(String(error))
      })
    })
    // While the network is cut, a new connection is reset as an unreachable host's would be.
    this.server.on('connection', (socket: Socket) => {
      if (this.networkCut) {
        socket.destroy()
        return
      }
      this.connections.add(socket)
      socket.once('close', () => this.connections.delete(socket))
    })
    // Next's dev server pushes over a websocket; pass upgrades straight through.
    this.server.on('upgrade', (request, socket, head) => {
      const target = new URL(config.upstream)
      const upstream = connect(Number(target.port), target.hostname, () => {
        const lines = [`${request.method} ${request.url} HTTP/1.1`]
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          lines.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`)
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
        upstream.write(head)
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      const client = socket
      this.sockets.add(upstream)
      this.sockets.add(client)
      const end = () => {
        upstream.destroy()
        client.destroy()
        this.sockets.delete(upstream)
        this.sockets.delete(client)
      }
      for (const side of [upstream, client]) {
        side.on('error', end)
        side.on('close', end)
      }
    })
  }

  start(): Promise<void> {
    return listen(this.server, this.config.proxyPort)
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    await close(this.server)
  }

  /** Holds the next request that matches until the returned handle releases it. */
  hold(
    matches: (method: string, path: string) => boolean,
    options: { deliverIfAbandoned?: boolean } = {}
  ): HeldRequest {
    const held = new HeldRequest(matches, options.deliverIfAbandoned)
    this.holds.push(held)
    return held
  }

  /** Drops holds that never matched, so none outlives the test that set it. */
  clearHolds(): void {
    for (const held of this.holds) held.release()
    this.holds = []
  }

  /**
   * Rewrites Sim's JSON answer to `path`, as a Sim configured otherwise would answer it; `undefined`
   * stops rewriting it.
   */
  rewriteAnswer(
    path: string,
    rewrite: ((body: Record<string, unknown>) => void) | undefined
  ): void {
    if (rewrite) this.answerRewrites.set(path, rewrite)
    else this.answerRewrites.delete(path)
  }

  /**
   * Sim's JSON answers to `path` that reach the app from now on, recorded as they pass and left
   * unchanged. An answer to a request whose client gave up reaches no one, so it is not recorded.
   */
  recordAnswers(path: string): Record<string, unknown>[] {
    const answers: Record<string, unknown>[] = []
    this.rewriteAnswer(path, (body) => {
      answers.push(structuredClone(body))
    })
    return answers
  }

  /**
   * Cuts the network between the app and Sim: every open connection drops mid-flight, the
   * doorbell stream included, and new ones are reset until `restoreNetwork`.
   */
  cutNetwork(): void {
    this.networkCut = true
    for (const socket of this.connections) socket.destroy()
  }

  restoreNetwork(): void {
    this.networkCut = false
  }

  /**
   * Resolves once every request the app made has been answered (held ones aside), staying so for
   * a moment, which on a dev app means none is waiting on a route to compile.
   */
  async settled(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let quietSince = Date.now()
    for (;;) {
      const waiting = this.requests.filter(
        (entry) =>
          entry.status === undefined &&
          entry.clientClosedAt === undefined &&
          !this.heldEntries.has(entry)
      )
      if (waiting.length > 0) quietSince = Date.now()
      else if (Date.now() - quietSince >= 3_000) return
      if (Date.now() > deadline)
        throw new Error(
          `Requests still unanswered: ${waiting.map((entry) => entry.path).join(', ')}`
        )
      await sleep(250)
    }
  }

  /** The requests seen since `since`, optionally only those under a path prefix. */
  seen(since = 0, prefix = '/'): ProxiedRequest[] {
    return this.requests.filter((entry) => entry.at >= since && entry.path.startsWith(prefix))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.origin)
    const method = request.method ?? 'GET'
    const entry: ProxiedRequest = { method, path: url.pathname, at: Date.now() }
    this.requests.push(entry)
    response.once('close', () => {
      if (!response.writableFinished) entry.clientClosedAt = Date.now()
    })
    if (url.pathname === '/__e2e/sign-in') {
      const cookie = url.searchParams.get('cookie') ?? ''
      response.writeHead(302, {
        'Set-Cookie': `better-auth.session_token=${cookie}; Path=/; HttpOnly; SameSite=Lax`,
        Location: url.searchParams.get('to') ?? '/',
      })
      response.end()
      entry.status = 302
      return
    }
    const body = await readBody(request)
    const held = this.holds.find((candidate) => candidate.matches(method, url.pathname))
    if (held) {
      this.holds = this.holds.filter((candidate) => candidate !== held)
      this.heldEntries.add(entry)
      const deliver = await held.hold(entry, response)
      this.heldEntries.delete(entry)
      if (!deliver && !held.deliverIfAbandoned) return
    }
    const target = new URL(url.pathname + url.search, this.config.upstream)
    const rewriteAnswer = this.answerRewrites.get(url.pathname)
    // The body is forwarded whole, so it is sent with a length rather than chunked. An answer to
    // rewrite is asked for uncompressed.
    const {
      'transfer-encoding': _chunked,
      'accept-encoding': acceptEncoding,
      ...forwarded
    } = request.headers
    const headers: IncomingHttpHeaders = {
      ...forwarded,
      ...(rewriteAnswer ? {} : { 'accept-encoding': acceptEncoding }),
      'content-length': String(body.length),
    }
    await new Promise<void>((resolve, reject) => {
      const clientGone = response.destroyed
      const upstream = httpRequest(target, { method, headers }, (upstreamResponse) => {
        entry.status = upstreamResponse.statusCode
        upstreamResponse.on('end', resolve)
        upstreamResponse.on('error', reject)
        // A request delivered after its client gave up is answered to no one.
        if (clientGone) {
          upstreamResponse.resume()
          return
        }
        if (rewriteAnswer && upstreamResponse.statusCode === 200) {
          void readBody(upstreamResponse).then((raw) => {
            const answer: Record<string, unknown> = JSON.parse(raw.toString('utf8'))
            rewriteAnswer(answer)
            const rewritten = Buffer.from(JSON.stringify(answer))
            const { 'transfer-encoding': _chunked, ...answerHeaders } = upstreamResponse.headers
            response.writeHead(200, {
              ...answerHeaders,
              'content-length': String(rewritten.length),
            })
            response.end(rewritten)
          }, reject)
          return
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      })
      if (!clientGone) response.on('close', () => upstream.destroy())
      upstream.on('error', reject)
      upstream.end(body)
    })
  }
}

/** One tool call a scripted turn issues. */
interface ScriptedToolCall {
  toolName: string
  args: Record<string, unknown>
  /** `awaiting_approval` asks Sim to hold the call for the user's decision. */
  status?: 'awaiting_approval'
}

/** One result Sim sends back when it resumes the agent after a checkpoint. */
interface ResumedResult {
  callId: string
  name?: string
  success?: boolean
  data?: unknown
}

/** A resume request Sim sent, with when it arrived. */
interface Resume {
  at: number
  streamId: string
  results: ResumedResult[]
}

/** A chat turn Sim opened against the agent, written to as the scripted model acts. */
class AgentTurn {
  readonly toolCallIds: string[] = []
  /** Settles once this leg's stream has ended, from either side. */
  readonly closed: Promise<void>
  private markClosed!: () => void
  private seq = 0
  private readonly keepAlive: ReturnType<typeof setInterval>
  private ended = false

  constructor(
    readonly body: Record<string, unknown>,
    readonly streamId: string,
    private readonly response: ServerResponse
  ) {
    this.closed = new Promise((resolve) => {
      this.markClosed = resolve
    })
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    // The worker keeps an idle stream alive with SSE comments; so does this one.
    this.keepAlive = setInterval(() => {
      if (!this.ended) response.write(': keepalive\n\n')
    }, 2_000)
    response.on('close', () => this.finish())
    this.emit('session', { kind: 'start' })
  }

  get message(): string {
    return typeof this.body.message === 'string' ? this.body.message : ''
  }

  emit(type: string, payload: Record<string, unknown>): void {
    if (this.ended) return
    this.seq += 1
    const chatId = typeof this.body.chatId === 'string' ? this.body.chatId : undefined
    const envelope = {
      v: 1,
      type,
      seq: this.seq,
      ts: new Date().toISOString(),
      stream: { streamId: this.streamId, ...(chatId ? { chatId } : {}), cursor: String(this.seq) },
      trace: { requestId: `agent-${this.streamId}` },
      payload,
    }
    this.response.write(`data: ${JSON.stringify(envelope)}\n\n`)
  }

  text(text: string): void {
    this.emit('text', { channel: 'assistant', text })
  }

  /** Issues a client-executed tool call and returns its id. */
  toolCall(call: ScriptedToolCall): string {
    const toolCallId = `toolu_${generateShortId()}`
    this.toolCallIds.push(toolCallId)
    this.emit('tool', {
      phase: 'call',
      toolCallId,
      toolName: call.toolName,
      executor: 'client',
      mode: 'async',
      arguments: call.args,
      ui: { clientExecutable: true },
      ...(call.status ? { status: call.status } : {}),
    })
    return toolCallId
  }

  /** Ends this leg waiting on the turn's tool calls, as the worker does at a checkpoint. */
  pause(): void {
    this.emit('run', {
      kind: 'checkpoint_pause',
      checkpointId: generateId(),
      executionId: generateId(),
      runId: generateId(),
      pendingToolCallIds: [...this.toolCallIds],
    })
    this.finish()
  }

  complete(text?: string): void {
    if (text) this.text(text)
    this.emit('complete', { status: 'complete' })
    this.finish()
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    clearInterval(this.keepAlive)
    this.response.end()
    this.markClosed()
  }
}

type TurnScript = (turn: AgentTurn) => void | Promise<void>
type ResumeScript = (resume: Resume, turn: AgentTurn) => void | Promise<void>

/**
 * Stands in for the Mothership worker at Sim's `SIM_AGENT_API_URL`: each chat turn runs the
 * script registered for its message, and each resume after a checkpoint records the tool results
 * Sim delivers, which is what the real model would read.
 */
export class ScriptedAgent {
  readonly turns: AgentTurn[] = []
  readonly resumes: Resume[] = []
  readonly unexpected: string[] = []
  private readonly server: Server
  private readonly scripts = new Map<string, TurnScript>()
  private readonly resumeScripts = new Map<string, ResumeScript>()
  private readonly waiters: (() => void)[] = []

  constructor(private readonly port: number) {
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.unexpected.push(String(error))
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  start(): Promise<void> {
    return listen(this.server, this.port)
  }

  stop(): Promise<void> {
    return close(this.server)
  }

  /**
   * Runs `script` for the turn whose message contains `marker`; `onResume` answers each resume of
   * that turn (by default the turn completes with a short reply).
   */
  script(marker: string, script: TurnScript, onResume?: ResumeScript): void {
    this.scripts.set(marker, script)
    if (onResume) this.resumeScripts.set(marker, onResume)
  }

  /** Resolves with the first resume matching `predicate`, failing after `timeoutMs`. */
  async waitForResume(predicate: (resume: Resume) => boolean, timeoutMs: number): Promise<Resume> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = this.resumes.find(predicate)
      if (found) return found
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`No matching resume within ${timeoutMs} ms`)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }

  /** The result Sim delivered for `toolCallId`, if any resume carried it. */
  resultFor(toolCallId: string): (ResumedResult & { at: number }) | undefined {
    for (const resume of this.resumes) {
      const result = resume.results.find((entry) => entry.callId === toolCallId)
      if (result) return { ...result, at: resume.at }
    }
    return undefined
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', this.url).pathname
    const raw = (await readBody(request)).toString('utf8')
    const body: Record<string, unknown> = raw ? JSON.parse(raw) : {}
    if (path === '/api/mothership' || path === '/api/copilot') {
      const message = typeof body.message === 'string' ? body.message : ''
      const streamId = typeof body.messageId === 'string' ? body.messageId : generateId()
      const turn = new AgentTurn(body, streamId, response)
      this.turns.push(turn)
      const entry = [...this.scripts].find(([marker]) => message.includes(marker))
      if (!entry) {
        turn.complete('No script for this message.')
        return
      }
      await entry[1](turn)
      return
    }
    if (path === '/api/tools/resume') {
      const streamId = typeof body.streamId === 'string' ? body.streamId : ''
      const results = toArray<ResumedResult>(body.results)
      const resume: Resume = { at: Date.now(), streamId, results }
      this.resumes.push(resume)
      for (const wake of this.waiters.splice(0)) wake()
      const turn = this.turns.find((candidate) => candidate.streamId === streamId)
      const resumed = new AgentTurn(turn?.body ?? body, streamId, response)
      const marker = turn
        ? [...this.resumeScripts.keys()].find((key) => turn.message.includes(key))
        : undefined
      const onResume = marker ? this.resumeScripts.get(marker) : undefined
      if (onResume) await onResume(resume, resumed)
      else resumed.complete('Done.')
      return
    }
    if (path === '/api/generate-chat-title') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ title: 'Desktop tools E2E' }))
      return
    }
    // Stop, cleanup and every other worker callback: acknowledge.
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ settled: true }))
  }
}

/** A seeded user signed in to Sim, with one workspace and named chats. */
export interface SeededUser {
  userId: string
  name: string
  workspaceId: string
  sessionId: string
  /** The `better-auth.session_token` cookie value for the seeded session. */
  cookie: string
  chats: Record<string, string>
}

/** Direct database access for seeding and for asserting what Sim persisted. */
export class SimDatabase {
  readonly sql: postgres.Sql
  private readonly userIds: string[] = []

  constructor(private readonly config: LiveSimConfig) {
    this.sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} })
  }

  async close(): Promise<void> {
    try {
      if (this.userIds.length > 0)
        await this.sql.begin(async (tx) => {
          await tx`delete from workspace where owner_id in ${tx(this.userIds)}`
          await tx`delete from project where owner_id in ${tx(this.userIds)}`
          await tx`delete from "user" where id in ${tx(this.userIds)}`
        })
    } finally {
      await this.sql.end({ timeout: 5 })
    }
  }

  /** A user with a workspace, a session as the desktop sign-in creates, and one chat per title. */
  async seedUser(chatTitles: string[]): Promise<SeededUser> {
    const userId = generateId()
    const workspaceId = generateId()
    const sessionId = generateId()
    const token = generateShortId()
    const name = `Desktop E2E ${userId.slice(0, 6)}`
    const email = `${userId}@desktop-tools-e2e.test`
    const chats: Record<string, string> = {}
    await this.sql.begin(async (tx) => {
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${userId}, ${name}, ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
      await tx`insert into project (id, name, owner_id)
        values (${workspaceId}, 'E2E fixture project', ${userId})`
      await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
        values (${workspaceId}, ${workspaceId}, 'Desktop tools E2E', ${userId}, ${userId})`
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
        values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
      await tx`insert into session (id, token, user_id, user_agent, expires_at, created_at, updated_at)
        values (${sessionId}, ${token}, ${userId}, 'Sim Desktop', now() + interval '1 day', now(), now())`
      for (const title of chatTitles) {
        const chatId = generateId()
        chats[title] = chatId
        await tx`insert into copilot_chats (id, user_id, workspace_id, type, title)
          values (${chatId}, ${userId}, ${workspaceId}, 'mothership', ${title})`
      }
    })
    this.userIds.push(userId)
    const signature = createHmac('sha256', this.config.authSecret).update(token).digest('base64')
    return {
      userId,
      name,
      workspaceId,
      sessionId,
      cookie: encodeURIComponent(`${token}.${signature}`),
      chats,
    }
  }

  /** The persisted desktop calls of a chat's runs, oldest first. */
  toolCalls(chatId: string) {
    return this.sql<
      {
        toolCallId: string
        toolName: string
        status: string
        claimedBy: string | null
        error: string | null
        result: unknown
        permissionRequestedAt: Date | null
        persistSeq: number | null
        runId: string
      }[]
    >`select c.tool_call_id as "toolCallId", c.tool_name as "toolName", c.status,
        c.claimed_by as "claimedBy", c.error, c.result,
        c.permission_requested_at as "permissionRequestedAt", c.persist_seq as "persistSeq",
        c.run_id as "runId"
      from copilot_async_tool_calls c join copilot_runs r on r.id = c.run_id
      where r.chat_id = ${chatId} order by c.created_at`
  }

  runs(chatId: string) {
    return this.sql<{ id: string; status: string; desktopDeviceId: string | null }[]>`
      select id, status, desktop_device_id as "desktopDeviceId" from copilot_runs
      where chat_id = ${chatId} order by created_at`
  }

  /** Names of the files a workspace holds. */
  async workspaceFileNames(workspaceId: string): Promise<string[]> {
    const rows = await this.sql<{ name: string }[]>`
      select original_name as name from workspace_files
      where workspace_id = ${workspaceId} and context = 'workspace' and deleted_at is null
      order by original_name`
    return rows.map((row) => row.name)
  }

  /** Names of the file folders a workspace holds. */
  async workspaceFolderNames(workspaceId: string): Promise<string[]> {
    const rows = await this.sql<{ name: string }[]>`
      select name from folder where workspace_id = ${workspaceId} and resource_type = 'file'
      order by name`
    return rows.map((row) => row.name)
  }
}

/**
 * Records every command Sim sends Redis (`MONITOR`), so a test can assert that a turn rang no
 * desktop doorbell. Speaks just enough RESP for that.
 */
export class RedisMonitor {
  readonly lines: string[] = []
  private socket: Socket | undefined

  constructor(private readonly url: string) {}

  async start(): Promise<void> {
    const target = new URL(this.url)
    const socket = connect(Number(target.port || 6379), target.hostname)
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    // Each command sent before MONITOR answers `+OK`; MONITOR's own `+OK` means it is recording.
    let pendingAcks = target.password ? 2 : 1
    let buffer = ''
    const acknowledged = new Promise<void>((resolve, reject) => {
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split('\r\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (pendingAcks > 0) {
            if (line.startsWith('-')) reject(new Error(`Redis refused MONITOR: ${line}`))
            else if (line === '+OK' && --pendingAcks === 0) resolve()
            continue
          }
          if (line.startsWith('+')) this.lines.push(line)
        }
      })
    })
    if (target.password) socket.write(`AUTH ${decodeURIComponent(target.password)}\r\n`)
    socket.write('MONITOR\r\n')
    await acknowledged
  }

  /** Commands seen that publish to a channel whose name contains `channel`. */
  publishesTo(channel: string): string[] {
    return this.lines.filter(
      (line) => /"publish"/i.test(line) && line.toLowerCase().includes(channel.toLowerCase())
    )
  }

  stop(): void {
    this.socket?.destroy()
  }
}
