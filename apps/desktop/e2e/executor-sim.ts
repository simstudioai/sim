import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from '@playwright/test'

/**
 * A fixture Sim that speaks the background executor's device protocol (register, inbox,
 * doorbell, claim, lease, complete, import) the way Sim's routes do, and the helpers the
 * executor's Electron suites share.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
export const WORKSPACE = 'ws-e2e'
const LEASE_RENEW_MS = 1_000
export const RECONCILE_MS = 2_000

type CallStatus = 'pending' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Completion {
  status: string
  message: string
  data?: Record<string, unknown>
  outcome: 'recorded' | 'duplicate' | 'superseded'
  at: number
}

export interface FixtureCall {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  chatId: string
  deviceId: string
  status: CallStatus
  issuedAt: number
  claimedAt?: number
  token?: string
  claims: number
  renewals: number
  completions: Completion[]
  acknowledged: boolean
}

export interface ImportedEntry {
  toolCallId: string
  kind: string
  sourceName: string
  relativePath: string
  sha256?: string
  bytes?: number
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class FixtureSim {
  readonly calls = new Map<string, FixtureCall>()
  readonly devices = new Map<string, { name: string; platform: string }>()
  readonly requests: string[] = []
  readonly hits = new Map<string, number>()
  readonly streams = new Map<string, Set<ServerResponse>>()
  readonly imported: ImportedEntry[] = []
  enabled = true
  offline = false
  droppedWhileOffline = 0
  private server: Server | null = null
  origin = ''
  private nextToken = 0

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    this.origin = `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    for (const streams of this.streams.values()) for (const stream of streams) stream.destroy()
    this.server?.closeAllConnections()
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
  }

  reset(): void {
    this.calls.clear()
    this.devices.clear()
    this.requests.length = 0
    this.hits.clear()
    this.imported.length = 0
    this.enabled = true
    this.offline = false
    this.droppedWhileOffline = 0
  }

  /** Persists a call for a device and rings its doorbell, as Sim's pre-persist and offer do. */
  issue(
    deviceId: string,
    chatId: string,
    toolName: string,
    args: Record<string, unknown>,
    status: CallStatus = 'pending'
  ): string {
    const toolCallId = `call-${this.calls.size + 1}-${toolName}`
    this.calls.set(toolCallId, {
      toolCallId,
      toolName,
      args,
      chatId,
      deviceId,
      status,
      issuedAt: Date.now(),
      claims: 0,
      renewals: 0,
      completions: [],
      acknowledged: false,
    })
    this.ring(deviceId, status === 'awaiting_approval' ? 'approval' : 'call')
    return toolCallId
  }

  /** Stop from any surface: Sim settles the call and tells the device to cancel. */
  stopCall(toolCallId: string): void {
    const call = this.requireCall(toolCallId)
    call.status = 'cancelled'
    this.ring(call.deviceId, 'cancel')
  }

  approve(toolCallId: string): void {
    const call = this.requireCall(toolCallId)
    call.status = 'pending'
    this.ring(call.deviceId, 'approval')
  }

  requireCall(toolCallId: string): FixtureCall {
    const call = this.calls.get(toolCallId)
    if (!call) throw new Error(`No fixture call ${toolCallId}`)
    return call
  }

  ring(deviceId: string, reason: string): void {
    for (const stream of this.streams.get(deviceId) ?? []) {
      stream.write(`event: inbox_changed\ndata: ${JSON.stringify({ reason })}\n\n`)
    }
  }

  private async raw(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const text = (await this.raw(request)).toString()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }

  /** Stores one entry of a claimed, running import, as Sim's import route does. */
  private async importEntry(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const query = Object.fromEntries(url.searchParams)
    const call = this.calls.get(query.toolCallId ?? '')
    if (
      request.method !== 'PUT' ||
      !call ||
      call.deviceId !== query.deviceId ||
      call.toolName !== 'import_local_files' ||
      call.token !== request.headers['x-sim-execution-token'] ||
      call.status !== 'running'
    ) {
      this.json(response, 404, { error: 'Desktop import not found' })
      return
    }
    // As Sim's route does: a file must declare its length, and arrive whole.
    if (query.kind === 'file' && request.headers['content-length'] === undefined) {
      this.json(response, 411, { error: 'A file import must declare its length' })
      return
    }
    const content = await this.raw(request)
    if (query.kind === 'file' && content.length !== Number(request.headers['content-length'])) {
      this.json(response, 400, { error: 'The file did not arrive whole' })
      return
    }
    const entry: ImportedEntry = {
      toolCallId: call.toolCallId,
      kind: query.kind ?? '',
      sourceName: query.sourceName ?? '',
      relativePath: query.relativePath ?? '',
      ...(query.kind === 'file' ? { sha256: sha256(content), bytes: content.length } : {}),
    }
    this.imported.push(entry)
    this.json(response, 200, {
      id: `entry-${this.imported.length}`,
      name: entry.relativePath.split('/').at(-1) || entry.sourceName,
    })
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private signedIn(request: IncomingMessage): boolean {
    return request.headers.cookie?.includes('better-auth.session_token=fixture') ?? false
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.origin)
    const path = url.pathname
    this.requests.push(`${request.method} ${path}`)
    if (path.startsWith('/api/desktop/') && this.offline) {
      this.droppedWhileOffline += 1
      request.socket.destroy()
      return
    }
    if (path === '/api/auth/get-session') {
      this.json(
        response,
        200,
        this.signedIn(request) ? { user: { id: 'user-e2e' }, session: { id: 'session-e2e' } } : null
      )
      return
    }
    if (path.startsWith('/api/desktop/') && !this.signedIn(request)) {
      this.json(response, 401, { error: 'Unauthorized' })
      return
    }
    if (path === '/api/desktop/devices' && request.method === 'POST') {
      const body = await this.body(request)
      if (this.enabled) {
        this.devices.set(String(body.deviceId), {
          name: String(body.name),
          platform: String(body.platform),
        })
      }
      this.json(response, 200, {
        enabled: this.enabled,
        protocolVersion: 1,
        leaseMs: 60_000,
        leaseRenewMs: LEASE_RENEW_MS,
        reconcileMs: RECONCILE_MS,
      })
      return
    }
    const deviceId = url.searchParams.get('deviceId')
    if (path === '/api/desktop/inbox/stream') {
      if (!deviceId || !this.devices.has(deviceId)) {
        this.json(response, 401, { error: 'Unregistered' })
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.write(': connected\n\n')
      const streams = this.streams.get(deviceId) ?? new Set<ServerResponse>()
      streams.add(response)
      this.streams.set(deviceId, streams)
      request.on('close', () => streams.delete(response))
      return
    }
    if (path === '/api/desktop/inbox') {
      if (!deviceId || !this.devices.has(deviceId)) {
        this.json(response, 401, { error: 'Unregistered' })
        return
      }
      const items = [...this.calls.values()]
        .filter((call) => call.deviceId === deviceId)
        .flatMap((call) => {
          if (call.status === 'pending' && !call.token)
            return [
              {
                kind: 'call',
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                chatId: call.chatId,
                workspaceId: WORKSPACE,
                createdAt: new Date(call.issuedAt).toISOString(),
              },
            ]
          if (call.status === 'awaiting_approval')
            return [
              {
                kind: 'approval_needed',
                toolCallId: call.toolCallId,
                toolName: call.toolName,
                chatId: call.chatId,
                chatTitle: 'Fix CI',
                workspaceId: WORKSPACE,
                summary: String((call.args.args as { command?: string } | undefined)?.command),
              },
            ]
          if (call.token && call.status === 'cancelled' && !call.acknowledged)
            return [{ kind: 'cancel', toolCallId: call.toolCallId }]
          return []
        })
      this.json(response, 200, { items })
      return
    }
    if (path === '/api/desktop/tool/import') {
      await this.importEntry(url, request, response)
      return
    }
    if (path.startsWith('/api/desktop/tool/')) {
      const body = await this.body(request)
      const call = this.calls.get(String(body.toolCallId))
      if (!call || call.deviceId !== body.deviceId) {
        this.json(response, 404, { error: 'Desktop tool call not found' })
        return
      }
      if (path === '/api/desktop/tool/claim') {
        if (call.status !== 'pending' || call.token) {
          this.json(response, 404, { error: 'This call is no longer waiting for this device' })
          return
        }
        call.claims += 1
        call.status = 'running'
        call.claimedAt = Date.now()
        call.token = `token-${++this.nextToken}`
        this.json(response, 200, {
          toolName: call.toolName,
          args: call.args,
          chatId: call.chatId,
          workspaceId: WORKSPACE,
          executionToken: call.token,
        })
        return
      }
      if (body.executionToken !== call.token) {
        this.json(response, 404, { error: 'Desktop tool call not found' })
        return
      }
      if (path === '/api/desktop/tool/lease') {
        call.renewals += 1
        if (call.status !== 'running') {
          this.json(response, 410, { error: 'This call was stopped or settled. Stop running it.' })
          return
        }
        this.json(response, 200, { renewed: true })
        return
      }
      if (path === '/api/desktop/tool/complete') {
        const status = String(body.status)
        const settled =
          status === 'success' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed'
        const outcome =
          call.status === 'running'
            ? 'recorded'
            : call.completions.length > 0
              ? 'duplicate'
              : 'superseded'
        if (outcome === 'recorded') call.status = settled
        if (call.status === 'cancelled') call.acknowledged = true
        call.completions.push({
          status,
          message: String(body.message ?? ''),
          ...(body.data && typeof body.data === 'object'
            ? { data: body.data as Record<string, unknown> }
            : {}),
          outcome,
          at: Date.now(),
        })
        this.json(response, 200, {
          outcome,
          status: call.status === 'running' ? settled : call.status,
        })
        return
      }
    }
    if (path === '/hit') {
      const chat = url.searchParams.get('chat') ?? ''
      this.hits.set(chat, (this.hits.get(chat) ?? 0) + 1)
      this.json(response, 200, { count: this.hits.get(chat) })
      return
    }
    if (path === '/session-ended') {
      // Another account signing in replaces the session: the old session cookie is cleared.
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'better-auth.session_token=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/',
      })
      response.end('<!doctype html><title>Signed in elsewhere</title>')
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
    })
    response.end(
      path === '/counter'
        ? `<!doctype html><title>Counter ${url.searchParams.get('chat')}</title>
<button onclick="fetch('/hit?chat=${url.searchParams.get('chat')}').then(r => r.json()).then(b => { document.getElementById('count').textContent = String(b.count) })">Count visit</button>
<p id="count">0</p>`
        : `<!doctype html><title>Sim fixture</title><h1>${path}</h1>`
    )
  }
}

export async function launch(
  sim: FixtureSim,
  userData: string,
  env: Record<string, string> = {}
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: sim.origin,
      SIM_DESKTOP_USER_DATA: userData,
      ...env,
    },
  })
  // A dialog listener stops Playwright auto-dismissing page dialogs, so the desktop's own handling
  // decides their outcome exactly as it does in production.
  const leaveDialogsToDesktop = (page: Page) => page.on('dialog', () => {})
  app.context().pages().forEach(leaveDialogsToDesktop)
  app.context().on('page', leaveDialogsToDesktop)
  const window = await app.firstWindow()
  return { app, window }
}

/** The device this app registered, once it has opened its doorbell. */
export async function registeredDevice(
  sim: FixtureSim,
  knownDevices: ReadonlySet<string> = new Set()
): Promise<string> {
  let deviceId: string | undefined
  await expect
    .poll(
      () => {
        deviceId = [...sim.devices.keys()].find(
          (id) => !knownDevices.has(id) && (sim.streams.get(id)?.size ?? 0) > 0
        )
        return deviceId
      },
      { timeout: 30_000 }
    )
    .toBeTruthy()
  return deviceId as string
}

export async function settled(
  sim: FixtureSim,
  toolCallId: string,
  timeout = 60_000
): Promise<Completion> {
  await expect
    .poll(() => sim.requireCall(toolCallId).completions.length, { timeout })
    .toBeGreaterThan(0)
  return sim.requireCall(toolCallId).completions[0] as Completion
}

export function refFor(outline: string, name: string): number {
  const match = outline
    .split('\n')
    .find((line) => line.includes(`"${name}"`) && /\[ref=\d+\]/.test(line))
    ?.match(/\[ref=(\d+)\]/)
  if (!match) throw new Error(`No reference for ${name}: ${outline}`)
  return Number(match[1])
}

export function processRunning(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern])
    return true
  } catch {
    return false
  }
}

export function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
