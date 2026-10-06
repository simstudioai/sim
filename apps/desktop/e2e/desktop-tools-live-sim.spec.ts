import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import {
  type LiveSimConfig,
  liveSimConfig,
  RedisMonitor,
  ScriptedAgent,
  type SeededUser,
  SimDatabase,
  SimProxy,
} from './fixtures/live-sim'

/**
 * Desktop tools in the real Electron app against a real local Sim: the renderer is Sim's own chat
 * view, every claim and result crosses Sim's routes into PostgreSQL and Redis, and only the
 * model's decisions are scripted (a stand-in worker at `SIM_AGENT_API_URL`). Each test checks
 * what the user or the model would observe: the result the model is resumed with, what landed in
 * the workspace, what Sim persisted, and which requests reached Sim.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const config = liveSimConfig()
const PICKUP_GRACE_MS = 15_000

type DesktopWindow = typeof globalThis & { simDesktop: SimDesktopApi }

test.describe('desktop tools against a live Sim', () => {
  test.skip(typeof config === 'string', typeof config === 'string' ? config : '')
  test.describe.configure({ timeout: 240_000 })

  let sim: LiveSimConfig
  let proxy: SimProxy
  let agent: ScriptedAgent
  let db: SimDatabase
  let app: ElectronApplication | undefined
  let scratch: string

  test.beforeAll(async () => {
    if (typeof config === 'string') throw new Error(config)
    sim = config
    proxy = new SimProxy(sim)
    agent = new ScriptedAgent(sim.agentPort)
    db = new SimDatabase(sim)
    await Promise.all([proxy.start(), agent.start()])
  })

  test.afterAll(async () => {
    await Promise.all([proxy?.stop(), agent?.stop(), db?.close()])
  })

  test.beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'sim-desktop-tools-live-'))
  })

  test.afterEach(async () => {
    const testInfo = test.info()
    if (testInfo.status !== testInfo.expectedStatus)
      await app
        ?.windows()[0]
        ?.screenshot({ path: testInfo.outputPath('failure.png') })
        .catch(() => {})
    await app?.close().catch(() => {})
    app = undefined
    proxy.rewriteChatBody(undefined)
    rmSync(scratch, { recursive: true, force: true })
  })

  const chatPath = (user: SeededUser, title: string) =>
    `/workspace/${user.workspaceId}/chat/${user.chats[title]}`

  /** Launches the app signed in as `user`, showing the chat titled `title`. */
  async function openApp(user: SeededUser, title: string): Promise<Page> {
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: proxy.origin,
        SIM_DESKTOP_USER_DATA: join(scratch, 'profile'),
      },
    })
    const page = await app.firstWindow()
    const signIn = new URL('/__e2e/sign-in', proxy.origin)
    signIn.searchParams.set('cookie', user.cookie)
    signIn.searchParams.set('to', chatPath(user, title))
    await page.goto(signIn.toString(), { waitUntil: 'commit', timeout: 180_000 })
    await expect(composer(page)).toBeVisible({ timeout: 180_000 })
    return page
  }

  const composer = (page: Page) => page.getByRole('textbox').last()

  async function send(page: Page, message: string): Promise<void> {
    await composer(page).fill(message)
    await page.getByRole('button', { name: 'Send message' }).click()
  }

  /** Switches chats in-app, the way the sidebar does, without reloading the page. */
  async function openChat(page: Page, user: SeededUser, title: string): Promise<void> {
    await page.getByRole('link', { name: title }).first().click()
    await expect(page).toHaveURL(new RegExp(`${user.chats[title]}$`))
  }

  function writeFile(path: string, contents: string): string {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
    return path
  }

  /** A folder to import: a file, then a subfolder holding another file. */
  function importSource(): string {
    const root = join(scratch, 'Reports')
    writeFile(join(root, 'a.txt'), 'first file')
    writeFile(join(root, 'later', 'b.txt'), 'second file')
    return root
  }

  /** The first request of a file's upload session. */
  const isUploadStart = (method: string, path: string) =>
    method === 'POST' && path === '/api/files/uploads'
  const isFolderCreate = (method: string, path: string) =>
    method === 'POST' && /^\/api\/workspaces\/[^/]+\/files\/folders$/.test(path)
  const isDesktopClaim = (method: string, path: string) =>
    method === 'POST' && path === '/api/desktop/tool/authorize'

  test('a browser call issued after the user switched chats fails as not started after the pickup grace', async () => {
    const user = await db.seedUser(['Browser chat', 'Other chat'])
    let issue!: () => void
    const issued = new Promise<void>((resolve) => {
      issue = resolve
    })
    let callId = ''
    let issuedAt = 0
    agent.script('[pickup-grace]', async (turn) => {
      turn.text('Checking your browser tabs.')
      await issued
      callId = turn.toolCall({ toolName: 'browser_list_tabs', args: {} })
      issuedAt = Date.now()
      turn.pause()
    })
    const page = await openApp(user, 'Browser chat')
    await send(page, '[pickup-grace] which tabs are open?')
    await expect(page.getByText('Checking your browser tabs.')).toBeVisible({ timeout: 60_000 })
    await openChat(page, user, 'Other chat')
    issue()

    await agent.waitForResume(() => Boolean(callId && agent.resultFor(callId)), 60_000)
    const result = agent.resultFor(callId)
    expect(result?.success).toBe(false)
    expect(result?.data).toMatchObject({ notStarted: true })
    const waited = (result?.at ?? 0) - issuedAt
    expect(waited).toBeGreaterThanOrEqual(PICKUP_GRACE_MS - 1_000)
    expect(waited).toBeLessThan(PICKUP_GRACE_MS + 20_000)
    const [call] = await db.toolCalls(user.chats['Browser chat'])
    expect(call).toMatchObject({ toolName: 'browser_list_tabs', status: 'failed', claimedBy: null })
  })

  test('leaving the chat does not end a local file read already under way', async () => {
    const user = await db.seedUser(['Read chat', 'Other chat'])
    const marker = randomUUID()
    const file = writeFile(join(scratch, 'notes.txt'), `notes from disk ${marker}`)
    let callId = ''
    agent.script('[leave-read]', (turn) => {
      callId = turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
      turn.pause()
    })
    const page = await openApp(user, 'Read chat')
    const claim = proxy.hold(isDesktopClaim)
    await send(page, '[leave-read] read my notes')
    await claim.reached
    await openChat(page, user, 'Other chat')
    claim.release()

    await agent.waitForResume(() => Boolean(callId && agent.resultFor(callId)), 60_000)
    const result = agent.resultFor(callId)
    expect(result?.success).toBe(true)
    expect(JSON.stringify(result?.data)).toContain(marker)
    const [call] = await db.toolCalls(user.chats['Read chat'])
    expect(call).toMatchObject({ toolName: 'read_local_file', status: 'completed' })
  })

  test('an import keeps running across chat switches, and Stop from the reopened chat ends it', async () => {
    const user = await db.seedUser(['Import chat', 'Other chat'])
    const source = importSource()
    agent.script('[stop-import]', (turn) => {
      turn.toolCall({
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: user.workspaceId },
      })
      turn.pause()
    })
    const page = await openApp(user, 'Import chat')
    const firstUpload = proxy.hold(isUploadStart)
    await send(page, '[stop-import] import my reports')
    await firstUpload.reached

    await openChat(page, user, 'Other chat')
    await openChat(page, user, 'Import chat')
    const laterFolder = proxy.hold(isFolderCreate)
    firstUpload.release()
    // The import outlived both view changes: its first file landed.
    await expect
      .poll(() => db.workspaceFileNames(user.workspaceId), { timeout: 30_000 })
      .toContain('a.txt')
    await laterFolder.reached

    await page.getByRole('button', { name: 'Stop generation' }).click()
    // Stop cancels the import's request in flight; nothing after it runs.
    await expect.poll(() => laterFolder.isAbandoned, { timeout: 15_000 }).toBe(true)
    laterFolder.release()
    await page.waitForTimeout(3_000)
    expect(await db.workspaceFolderNames(user.workspaceId)).not.toContain('later')
    expect(await db.workspaceFileNames(user.workspaceId)).toEqual(['a.txt'])
    // Whichever lands first, the cancelled import's report or Stop's settlement, it never completes.
    const [call] = await db.toolCalls(user.chats['Import chat'])
    expect(call.toolName).toBe('import_local_files')
    expect(['cancelled', 'failed']).toContain(call.status)
  })

  test('signing out ends a desktop tool still running', async () => {
    const user = await db.seedUser(['Import chat'])
    const source = importSource()
    agent.script('[sign-out-import]', (turn) => {
      turn.toolCall({
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: user.workspaceId },
      })
      turn.pause()
    })
    const page = await openApp(user, 'Import chat')
    const firstUpload = proxy.hold(isUploadStart)
    await send(page, '[sign-out-import] import my reports')
    await firstUpload.reached

    // The desktop reloads into the login page once signing out completes, which would end any
    // tool; holding the sign-out shows the tool ends at sign-out itself, not at that reload.
    const signOut = proxy.hold((method, path) => method === 'POST' && path === '/api/auth/sign-out')
    await page.getByRole('button', { name: user.name }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await signOut.reached
    await expect.poll(() => firstUpload.isAbandoned, { timeout: 15_000 }).toBe(true)
    const abandonedAt = Date.now()
    signOut.release()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
    firstUpload.release()
    await page.waitForTimeout(3_000)
    const toolRequests = proxy
      .seen(abandonedAt)
      .filter(
        (entry) =>
          isUploadStart(entry.method, entry.path) || isFolderCreate(entry.method, entry.path)
      )
    expect(toolRequests).toEqual([])
    expect(await db.workspaceFileNames(user.workspaceId)).toEqual([])
    expect(await db.workspaceFolderNames(user.workspaceId)).not.toContain('later')
  })

  /** Sends `message` and returns the `toolName` call Sim persisted for it, held for approval. */
  async function gatedCall(page: Page, chatId: string, message: string, toolName: string) {
    await send(page, message)
    await expect
      .poll(async () => (await db.toolCalls(chatId)).some((call) => call.toolName === toolName), {
        timeout: 60_000,
      })
      .toBe(true)
    const call = (await db.toolCalls(chatId)).find((entry) => entry.toolName === toolName)
    if (!call) throw new Error(`Missing ${toolName} call`)
    expect(call.status).toBe('pending')
    expect(call.permissionRequestedAt).not.toBeNull()
    return call
  }

  test("a local read awaiting the user's approval cannot be claimed", async () => {
    const user = await db.seedUser(['Approval chat'])
    const secret = randomUUID()
    const file = writeFile(join(scratch, 'secret.txt'), `private ${secret}`)
    agent.script('[unapproved-read]', (turn) => {
      turn.toolCall({
        toolName: 'read_local_file',
        args: { path: file },
        status: 'awaiting_approval',
      })
      turn.pause()
    })
    const page = await openApp(user, 'Approval chat')
    const chatId = user.chats['Approval chat']
    const read = await gatedCall(
      page,
      chatId,
      '[unapproved-read] read my secret',
      'read_local_file'
    )

    // A renderer acting on a call the user has not allowed (a replayed event) is refused.
    const response = await page.evaluate(
      (toolCallId) =>
        (globalThis as DesktopWindow).simDesktop.localFiles?.({ operation: 'read', toolCallId }),
      read.toolCallId
    )
    expect(response?.ok).toBe(false)
    expect(JSON.stringify(response)).not.toContain(secret)
    const [after] = await db.toolCalls(chatId)
    expect(after).toMatchObject({ status: 'pending', claimedBy: null })
  })

  test("a terminal command awaiting the user's approval cannot be claimed or run", async () => {
    const user = await db.seedUser(['Approval chat'])
    const touched = join(scratch, 'terminal-ran')
    const command = `touch '${touched}'`
    agent.script('[unapproved-run]', (turn) => {
      turn.toolCall({ toolName: 'terminal', args: { operation: 'run', command } })
      turn.pause()
    })
    const page = await openApp(user, 'Approval chat')
    const chatId = user.chats['Approval chat']
    const run = await gatedCall(page, chatId, '[unapproved-run] run a command', 'terminal')

    const response = await page.evaluate(
      ({ toolCallId, command }) =>
        (globalThis as DesktopWindow).simDesktop.terminal
          .executeTool(toolCallId, 'run', { command }, 'unapproved-e2e')
          .catch((error: unknown) => ({ ok: false, error: String(error) })),
      { toolCallId: run.toolCallId, command }
    )
    await page.waitForTimeout(3_000)
    expect(existsSync(touched)).toBe(false)
    expect(response).toMatchObject({ ok: false })
    const [after] = await db.toolCalls(chatId)
    expect(after).toMatchObject({ status: 'pending', claimedBy: null })
  })

  test('a claim that reaches Sim after the user pressed Stop is refused', async () => {
    const user = await db.seedUser(['Stop chat'])
    const file = writeFile(join(scratch, 'notes.txt'), 'notes')
    agent.script('[stopped-claim]', (turn) => {
      turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
      turn.pause()
    })
    const page = await openApp(user, 'Stop chat')
    const chatId = user.chats['Stop chat']
    const lateClaim = proxy.hold(isDesktopClaim)
    await send(page, '[stopped-claim] read my secret')
    const claim = await lateClaim.reached
    await page.getByRole('button', { name: 'Stop generation' }).click()
    // Stop settles the call nobody has claimed yet as never started.
    await expect
      .poll(async () => (await db.toolCalls(chatId))[0]?.status, { timeout: 15_000 })
      .toBe('cancelled')
    lateClaim.release()
    await expect.poll(() => claim.status, { timeout: 15_000 }).toBe(410)
    const [after] = await db.toolCalls(chatId)
    expect(after).toMatchObject({ status: 'cancelled', claimedBy: null })
  })

  test('with the background executor off, a foreground desktop round trip never binds a device or rings a doorbell', async () => {
    const user = await db.seedUser(['Round trip'])
    const marker = randomUUID()
    const file = writeFile(join(scratch, 'plan.txt'), `plan ${marker}`)
    const deviceId = randomUUID()
    const monitor = new RedisMonitor(sim.redisUrl)
    await monitor.start()
    try {
      // A desktop that speaks the executor protocol registers and offers itself for the turn.
      const registration = await fetch(new URL('/api/desktop/devices', sim.upstream), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `better-auth.session_token=${user.cookie}`,
          Origin: proxy.origin,
          'User-Agent': 'Sim Desktop',
        },
        body: JSON.stringify({
          deviceId,
          name: 'E2E desktop',
          appVersion: '0.9.0',
          platform: `${process.platform}-${process.arch}`,
          capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
        }),
      })
      expect(registration.status).toBe(200)
      expect(await registration.json()).toMatchObject({ enabled: false })
      proxy.rewriteChatBody((body) => {
        const desktop =
          typeof body.desktopCapabilities === 'object' && body.desktopCapabilities !== null
            ? body.desktopCapabilities
            : {}
        body.desktopCapabilities = { ...desktop, deviceId, executor: 1 }
      })

      let callId = ''
      agent.script(
        '[round-trip]',
        (turn) => {
          turn.text('Reading the plan.')
          callId = turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
          turn.pause()
        },
        (resume, turn) => {
          const result = resume.results.find((entry) => entry.callId === callId)
          turn.complete(
            JSON.stringify(result?.data).includes(marker) ? 'The plan says go.' : 'Could not read.'
          )
        }
      )
      const since = Date.now()
      const page = await openApp(user, 'Round trip')
      await send(page, '[round-trip] what does my plan say?')
      await expect(page.getByText('The plan says go.')).toBeVisible({ timeout: 60_000 })

      expect(agent.resultFor(callId)?.success).toBe(true)
      expect(await db.desktopDeviceCount(user.userId)).toBe(0)
      const runs = await db.runs(user.chats['Round trip'])
      expect(runs.length).toBeGreaterThan(0)
      for (const run of runs) expect(run.desktopDeviceId).toBeNull()
      const [call] = await db.toolCalls(user.chats['Round trip'])
      expect(call).toMatchObject({ toolName: 'read_local_file', status: 'completed' })
      expect(call.persistSeq).not.toBeNull()
      // From launch on, only the foreground claim reaches the desktop routes: no registry, inbox,
      // lease or completion.
      const desktopRoutes = proxy.seen(since, '/api/desktop/').map((entry) => entry.path)
      expect(desktopRoutes.length).toBeGreaterThan(0)
      expect(new Set(desktopRoutes)).toEqual(new Set(['/api/desktop/tool/authorize']))
      expect(proxy.rewrittenChatBodies).toBeGreaterThan(0)
      expect(monitor.lines.length).toBeGreaterThan(0)
      expect(monitor.publishesTo('desktop:inbox')).toEqual([])
    } finally {
      monitor.stop()
    }
  })
})
