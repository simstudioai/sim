import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'

/**
 * The Sim desktop app's background executor against a fixture Sim that speaks the executor's
 * device protocol (register, inbox, doorbell, claim, lease, complete) the way Sim's routes do.
 * The window navigates, reloads and leaves the chats while their calls run: nothing in this
 * suite depends on a chat view, which is the point. Each scenario's checks land in a JSON
 * report at BACKGROUND_EXECUTOR_REPORT_PATH.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const WORKSPACE = 'ws-e2e'
const CHAT_A = 'chat-browser-a'
const CHAT_B = 'chat-terminal-b'
const CHAT_C = 'chat-idle-c'
const LEASE_RENEW_MS = 1_000
const RECONCILE_MS = 2_000

type CallStatus = 'pending' | 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'cancelled'

interface Completion {
  status: string
  message: string
  data?: Record<string, unknown>
  outcome: 'recorded' | 'duplicate' | 'superseded'
  at: number
}

interface FixtureCall {
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

interface ReportCheck {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

const report: ReportCheck[] = []

class FixtureSim {
  readonly calls = new Map<string, FixtureCall>()
  readonly devices = new Map<string, { name: string; platform: string }>()
  readonly requests: string[] = []
  readonly hits = new Map<string, number>()
  readonly streams = new Map<string, Set<ServerResponse>>()
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

  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    let text = ''
    for await (const chunk of request) text += chunk.toString()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
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

const sim = new FixtureSim()

async function launch(userData: string): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: sim.origin,
      SIM_DESKTOP_USER_DATA: userData,
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
async function registeredDevice(knownDevices: ReadonlySet<string> = new Set()): Promise<string> {
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

async function settled(toolCallId: string, timeout = 60_000): Promise<Completion> {
  await expect
    .poll(() => sim.requireCall(toolCallId).completions.length, { timeout })
    .toBeGreaterThan(0)
  return sim.requireCall(toolCallId).completions[0] as Completion
}

async function check(name: string, body: () => Promise<void>): Promise<void> {
  const startedAt = Date.now()
  try {
    await body()
    report.push({ name, status: 'passed', durationMs: Date.now() - startedAt })
  } catch (error) {
    report.push({
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    })
    throw error
  }
}

function refFor(outline: string, name: string): number {
  const match = outline
    .split('\n')
    .find((line) => line.includes(`"${name}"`) && /\[ref=\d+\]/.test(line))
    ?.match(/\[ref=(\d+)\]/)
  if (!match) throw new Error(`No reference for ${name}: ${outline}`)
  return Number(match[1])
}

function processRunning(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern])
    return true
  } catch {
    return false
  }
}

test.describe('background executor', () => {
  let app: ElectronApplication | null = null

  test.beforeAll(async () => {
    await sim.start()
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    app = null
    sim.reset()
  })

  test.afterAll(async () => {
    await sim.stop()
    const reportPath = process.env.BACKGROUND_EXECUTOR_REPORT_PATH
    if (reportPath) {
      writeFileSync(
        reportPath,
        JSON.stringify({ suite: 'background-executor', checks: report }, null, 2)
      )
    }
  })

  test('A: two chats run browser and terminal work while the user is elsewhere and reloads', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-a-'))
    const launched = await launch(userData)
    app = launched.app
    const window = launched.window
    const deviceId = await registeredDevice()
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    const marker = join(userData, 'terminal-marker.txt')
    const readable = join(userData, 'notes.txt')
    writeFileSync(readable, 'background read fixture')

    await check('A: chat A opens its page in the background', async () => {
      const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
        url: `${sim.origin}/counter?chat=A`,
      })
      const completion = await settled(opened)
      expect(completion.status, completion.message).toBe('success')
    })
    const opened = [...sim.calls.values()][0] as FixtureCall
    const outline = (opened.completions[0]?.data?.snapshot as { outline: string }).outline
    const button = refFor(outline, 'Count visit')

    const clicks = Array.from({ length: 10 }, () =>
      sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })
    )
    const terminalRuns = [1, 2, 3].map((n) =>
      sim.issue(deviceId, CHAT_B, 'terminal', {
        operation: 'run',
        args: { command: `sleep 1; echo B-${n} >> '${marker}'`, waitSeconds: 30 },
      })
    )
    const localRead = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })

    await window.goto(`${sim.origin}/workspace/ws-other/home`)
    await window.reload()
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    await check('A: every call completes exactly once with its own token', async () => {
      for (const id of [...clicks, ...terminalRuns, localRead]) {
        const completion = await settled(id, 90_000)
        const call = sim.requireCall(id)
        expect(completion.status, `${call.toolName}: ${completion.message}`).toBe('success')
        expect(completion.outcome).toBe('recorded')
        expect(call.claims).toBe(1)
        expect(call.completions).toHaveLength(1)
      }
    })

    await check('A: the page saw each click exactly once', async () => {
      await expect.poll(() => sim.hits.get('A')).toBe(10)
    })

    await check('A: chat B ran each command once, in order, in its own terminal', async () => {
      expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['B-1', 'B-2', 'B-3'])
      const read = sim.requireCall(localRead).completions[0]
      expect(JSON.stringify(read?.data)).toContain('background read fixture')
    })

    await check("A: chat B cannot see chat A's tabs", async () => {
      const listed = sim.issue(deviceId, CHAT_B, 'browser_list_tabs', {})
      const completion = await settled(listed)
      expect(JSON.stringify(completion.data)).not.toContain('/counter')
    })

    await check('A: no chat view executed or reported a call', async () => {
      expect(sim.requests.filter((request) => request.includes('/api/copilot/confirm'))).toEqual([])
      expect(
        sim.requests.filter((request) => request.includes('/api/desktop/tool/authorize'))
      ).toEqual([])
    })

    await check('A: calls are picked up within 1.5 s at p95', async () => {
      const latencies = [...sim.calls.values()]
        .map((call) => (call.claimedAt ?? Number.POSITIVE_INFINITY) - call.issuedAt)
        .sort((a, b) => a - b)
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
      expect(p95).toBeLessThan(1_500)
    })

    await check('A: the lease is renewed while calls wait and run', async () => {
      expect(Math.max(...terminalRuns.map((id) => sim.requireCall(id).renewals))).toBeGreaterThan(0)
    })
  })

  test('B: a result produced while offline is delivered once after reconnecting', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-b-'))
    app = (await launch(userData)).app
    const deviceId = await registeredDevice()

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: 'sleep 2; echo offline-done', waitSeconds: 30 },
    })
    await expect.poll(() => sim.requireCall(run).claims).toBe(1)
    sim.offline = true
    await sleep(6_000)

    await check('B: nothing reached Sim while offline', async () => {
      expect(sim.requireCall(run).completions).toHaveLength(0)
      expect(sim.droppedWhileOffline).toBeGreaterThan(0)
    })
    sim.offline = false

    await check('B: the result arrives once after reconnecting', async () => {
      const completion = await settled(run, 60_000)
      expect(completion.status).toBe('success')
      expect(JSON.stringify(completion.data)).toContain('offline-done')
      await sleep(3_000)
      expect(sim.requireCall(run).completions).toHaveLength(1)
    })
  })

  test('C: a crash mid-command reports the outcome as unknown and never reruns it', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-c-'))
    const marker = join(userData, 'crash-marker.txt')
    const first = await launch(userData)
    const deviceId = await registeredDevice()

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: `echo started >> '${marker}'; sleep 40`, waitSeconds: 60 },
    })
    await expect.poll(() => readFileSafe(marker), { timeout: 30_000 }).toContain('started')
    first.app.process().kill('SIGKILL')
    sim.streams.get(deviceId)?.clear()

    app = (await launch(userData)).app

    await check('C: the restarted app reports the lost result as outcome unknown', async () => {
      const completion = await settled(run, 60_000)
      expect(completion.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
    })

    await check('C: the command ran exactly once', async () => {
      expect(sim.requireCall(run).claims).toBe(1)
      expect(readFileSafe(marker).trim().split('\n')).toEqual(['started'])
    })
  })

  test('E: Stop from another chat stops a running browser wait and terminal command', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-e-'))
    app = (await launch(userData)).app
    const deviceId = await registeredDevice()

    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=E`,
    })
    await settled(opened)
    const wait = sim.issue(deviceId, CHAT_A, 'browser_wait_for', {
      text: 'never appears',
      timeoutMs: 30_000,
    })
    const command = 'sleep 47'
    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command, waitSeconds: 60 },
    })
    await expect.poll(() => sim.requireCall(wait).claims).toBe(1)
    await expect.poll(() => processRunning(command), { timeout: 20_000 }).toBe(true)

    const stoppedAt = Date.now()
    sim.stopCall(wait)
    sim.stopCall(run)

    await check('E: both stopped calls are acknowledged within seconds', async () => {
      await settled(wait, 10_000)
      await settled(run, 15_000)
      expect(sim.requireCall(wait).completions[0]?.outcome).toBe('superseded')
      expect(sim.requireCall(run).completions[0]?.outcome).toBe('superseded')
      expect((sim.requireCall(wait).completions[0]?.at ?? 0) - stoppedAt).toBeLessThan(5_000)
    })

    await check('E: the stopped command no longer runs on the machine', async () => {
      await expect.poll(() => processRunning(command), { timeout: 10_000 }).toBe(false)
    })
  })

  test('F: a call waiting for approval in a background chat notifies, then runs once approved', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-f-'))
    app = (await launch(userData)).app
    await app.evaluate(({ Notification }) => {
      const shown: Array<{ title: string; body: string }> = []
      const target = globalThis as typeof globalThis & { __shownNotifications?: typeof shown }
      target.__shownNotifications = shown
      Notification.prototype.show = function show(this: { title: string; body: string }) {
        shown.push({ title: this.title, body: this.body })
      }
    })
    const deviceId = await registeredDevice()

    const gated = sim.issue(
      deviceId,
      CHAT_B,
      'terminal',
      { operation: 'run', args: { command: 'echo approved-run', waitSeconds: 30 } },
      'awaiting_approval'
    )

    await check('F: the user is notified, without the command in the notification', async () => {
      await expect
        .poll(
          () =>
            app?.evaluate(
              () =>
                (globalThis as { __shownNotifications?: Array<{ body: string }> })
                  .__shownNotifications ?? []
            ),
          { timeout: 15_000 }
        )
        .toHaveLength(1)
      const shown = await app?.evaluate(
        () =>
          (globalThis as { __shownNotifications?: Array<{ body: string }> }).__shownNotifications
      )
      expect(JSON.stringify(shown)).not.toContain('approved-run')
    })

    await check('F: nothing runs before approval', async () => {
      await sleep(RECONCILE_MS * 2)
      expect(sim.requireCall(gated).claims).toBe(0)
    })

    sim.approve(gated)
    const approvedAt = Date.now()
    await check('F: the approved call is claimed promptly and runs once', async () => {
      const completion = await settled(gated)
      expect((sim.requireCall(gated).claimedAt ?? 0) - approvedAt).toBeLessThan(1_500)
      expect(JSON.stringify(completion.data)).toContain('approved-run')
    })
  })

  test('G: only the device a turn is bound to claims its calls', async () => {
    const first = await launch(mkdtempSync(join(tmpdir(), 'sim-executor-g1-')))
    const firstDevice = await registeredDevice()
    const second = await launch(mkdtempSync(join(tmpdir(), 'sim-executor-g2-')))
    const secondDevice = await registeredDevice(new Set([firstDevice]))
    app = first.app

    const call = sim.issue(firstDevice, CHAT_A, 'browser_list_tabs', {})
    await check('G: the bound device runs it and the other never claims it', async () => {
      await settled(call)
      expect(sim.requireCall(call).claims).toBe(1)
      expect(
        sim.requests.filter((request) => request === 'POST /api/desktop/tool/claim').length
      ).toBe(1)
      expect(secondDevice).not.toBe(firstDevice)
    })
    await second.app.close()
  })

  test('H: a device Sim has not enabled offers no binding', async () => {
    sim.enabled = false
    const launched = await launch(mkdtempSync(join(tmpdir(), 'sim-executor-h-')))
    app = launched.app
    await launched.window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)
    await expect.poll(() => sim.requests.includes('POST /api/desktop/devices')).toBe(true)

    await check(
      'H: the composer gets no device, so its turns stay with the chat view',
      async () => {
        const device = await launched.window.evaluate(() =>
          (
            globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
          ).simDesktop.desktopExecutor?.getDevice()
        )
        expect(device).toBeNull()
      }
    )

    sim.enabled = true
    await launched.app.close()
    const enabled = await launch(mkdtempSync(join(tmpdir(), 'sim-executor-h2-')))
    app = enabled.app
    const deviceId = await registeredDevice()
    await enabled.window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)
    await check('H: an enabled device offers itself for binding', async () => {
      const device = await enabled.window.evaluate(() =>
        (
          globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
        ).simDesktop.desktopExecutor?.getDevice()
      )
      expect(device).toEqual({ deviceId, protocolVersion: 1 })
    })
  })

  test('I: the agent yields its page while the user works in it, then takes it back', async () => {
    app = (await launch(mkdtempSync(join(tmpdir(), 'sim-executor-i-')))).app
    const deviceId = await registeredDevice()
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=I`,
    })
    const outline = ((await settled(opened)).data?.snapshot as { outline: string }).outline
    const button = refFor(outline, 'Count visit')

    const typeInAgentPage = () =>
      app?.evaluate(({ webContents }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().includes('/counter?chat=I'))
        page?.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
        page?.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      })
    await typeInAgentPage()
    const click = sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })
    for (let i = 0; i < 4; i++) {
      await sleep(500)
      await typeInAgentPage()
    }
    const lastUserInputAt = Date.now()

    await check('I: the click waits until the user stops, then runs once', async () => {
      const completion = await settled(click, 30_000)
      expect(completion.status, completion.message).toBe('success')
      expect(completion.at - lastUserInputAt).toBeGreaterThanOrEqual(3_000)
      await expect.poll(() => sim.hits.get('I')).toBe(1)
    })
  })

  test('I: an action the user never stops working long enough for does not run', async () => {
    app = (await launch(mkdtempSync(join(tmpdir(), 'sim-executor-i2-')))).app
    const deviceId = await registeredDevice()
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=I2`,
    })
    const outline = ((await settled(opened)).data?.snapshot as { outline: string }).outline
    const button = refFor(outline, 'Count visit')
    const typeInAgentPage = () =>
      app?.evaluate(({ webContents }) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().includes('/counter?chat=I2'))
        page?.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
        page?.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      })

    await typeInAgentPage()
    const click = sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })
    let typing = true
    const keepTyping = (async () => {
      while (typing) {
        await typeInAgentPage()
        await sleep(1_000)
      }
    })()

    await check('I: the click reports it never ran, instead of timing out', async () => {
      const completion = await settled(click, 60_000)
      typing = false
      await keepTyping
      expect(completion.status).toBe('error')
      expect(completion.message).toContain('Not run: the user kept working in this page')
      expect(completion.data).not.toMatchObject({ outcomeUnknown: true })
      expect(sim.hits.get('I2') ?? 0).toBe(0)
    })
  })

  test('J: the machine stays awake only while a chat has work running', async () => {
    app = (await launch(mkdtempSync(join(tmpdir(), 'sim-executor-j-')))).app
    await app.evaluate(({ powerSaveBlocker }) => {
      const log: string[] = []
      const active = new Set<number>()
      let next = 1
      const target = globalThis as typeof globalThis & { __sleepBlocks?: string[] }
      target.__sleepBlocks = log
      powerSaveBlocker.start = (type) => {
        log.push(`start:${type}`)
        active.add(next)
        return next++
      }
      powerSaveBlocker.stop = (id) => {
        log.push('stop')
        active.delete(id)
        return true
      }
      powerSaveBlocker.isStarted = (id) => active.has(id)
    })
    const deviceId = await registeredDevice()
    const sleepLog = () =>
      app?.evaluate(() => (globalThis as { __sleepBlocks?: string[] }).__sleepBlocks ?? [])

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: 'sleep 3; echo awake', waitSeconds: 30 },
    })
    await check('J: a blocker is held while the command runs', async () => {
      await expect.poll(sleepLog, { timeout: 15_000 }).toEqual(['start:prevent-app-suspension'])
    })
    await check('J: it is released once the result is delivered', async () => {
      await settled(run)
      await expect
        .poll(sleepLog, { timeout: 10_000 })
        .toEqual(['start:prevent-app-suspension', 'stop'])
    })
  })
})

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
