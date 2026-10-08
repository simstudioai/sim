import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
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
 *
 * Sim runs the background executor wherever it has Redis, as it does here. Most tests cover the
 * chat view running desktop tools itself, as on an install without Redis: the proxy answers the
 * app's registration as such an install does, so the app stays dormant and no turn binds to it.
 * The tests marked as running in the background let Sim's own answer through.
 */

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const config = liveSimConfig()
const PICKUP_GRACE_MS = 15_000
/** Longer than the default tool budget (60 s) plus the resume grace (30 s). */
const LONG_IMPORT_MS = 120_000
/** The execution lease a running import holds and renews (`SIM_TOOL_EXECUTION_LEASE_SECONDS`). */
const LEASE_MS = 60_000
/** How long a held request may take to arrive once the step that sends it ran. */
const ARRIVAL_MS = 60_000
/** First requests to a route compile it, which takes minutes on a cold dev app. */
const COMPILE_MS = 300_000
const REGISTRATION_PATH = '/api/desktop/devices'
const DESKTOP_COMPLETION_PATH = '/api/desktop/tool/complete'
/** Sim's answer to registration on an install that cannot run the background executor. */
const executorUnavailable = (answer: Record<string, unknown>) => {
  answer.enabled = false
}

type DesktopWindow = typeof globalThis & { simDesktop: SimDesktopApi }

test.describe('desktop tools against a live Sim', () => {
  test.skip(typeof config === 'string', typeof config === 'string' ? config : '')
  test.describe.configure({ timeout: 360_000 })

  let sim: LiveSimConfig
  let proxy: SimProxy
  let agent: ScriptedAgent
  let db: SimDatabase
  let app: ElectronApplication | undefined
  let scratch: string
  /** Errors the current window reported, shown when a click is blocked. */
  let pageErrors: string[] = []
  let testStartedAt = 0

  test.beforeAll(async () => {
    test.setTimeout(1_500_000)
    if (typeof config === 'string') throw new Error(config)
    sim = config
    proxy = new SimProxy(sim)
    agent = new ScriptedAgent(sim.agentPort)
    db = new SimDatabase(sim)
    await Promise.all([proxy.start(), agent.start()])
    proxy.rewriteAnswer(REGISTRATION_PATH, executorUnavailable)
    await test.step('warm up the routes the tests use', warmUp)
  })

  test.afterAll(async () => {
    await Promise.all([proxy?.stop(), agent?.stop(), db?.close()])
  })

  test.beforeEach(() => {
    testStartedAt = Date.now()
    scratch = mkdtempSync(join(tmpdir(), 'sim-desktop-tools-live-'))
  })

  test.afterEach(async () => {
    const testInfo = test.info()
    if (testInfo.status !== testInfo.expectedStatus) {
      const page = app?.windows()[0]
      await page?.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {})
      writeFileSync(
        testInfo.outputPath('diagnostics.json'),
        JSON.stringify(
          {
            url: page?.url(),
            composer: await page
              ?.getByRole('textbox')
              .last()
              .inputValue({ timeout: 2_000 })
              .catch(() => null),
            pageErrors,
            requests: proxy
              .seen(testStartedAt)
              .filter((entry) => !entry.path.startsWith('/_next/')),
          },
          null,
          2
        )
      )
    }
    proxy.clearHolds()
    proxy.restoreNetwork()
    await app?.close().catch(() => {})
    app = undefined
    proxy.rewriteAnswer(REGISTRATION_PATH, executorUnavailable)
    proxy.rewriteAnswer(DESKTOP_COMPLETION_PATH, undefined)
    rmSync(scratch, { recursive: true, force: true })
  })

  /**
   * A dev app compiles each route on its first request, one at a time, so a route first reached
   * mid-test stalls every other request (Electron gives a tool authorization 8 s). The warm-up runs
   * the tests' own flows once: a read and an import, a chat switch during a live turn and back,
   * Stop, and the login page. It then waits until every request the app made has been answered,
   * so no route the tests reach is left to compile. It ends with a marker request
   * (`/api/health?e2e=warm-up-done`) so the dev server's log shows anything compiled after it.
   */
  async function warmUp(): Promise<void> {
    scratch = mkdtempSync(join(tmpdir(), 'sim-desktop-tools-warm-'))
    try {
      const user = await db.seedUser(['Warm chat', 'Warm other chat'])
      const headers = {
        'Content-Type': 'application/json',
        Cookie: `better-auth.session_token=${user.cookie}`,
        Origin: proxy.origin,
      }
      const compile = (path: string, method: 'GET' | 'POST' | 'PUT' = 'GET') =>
        fetch(new URL(path, sim.upstream), {
          method,
          headers,
          body: method === 'GET' ? undefined : '{}',
          redirect: 'manual',
          signal: AbortSignal.timeout(COMPILE_MS),
        }).then((response) => response.arrayBuffer())
      // Routes the tests reach that a warm-up turn alone would not: Stop's, registration, and the
      // ones a running app loads in the background.
      for (const path of [
        chatPath(user, 'Warm chat'),
        '/login',
        `/api/mothership/chats/${user.chats['Warm other chat']}`,
        `/api/mothership/chat/stream?chatId=${user.chats['Warm chat']}`,
        `/api/workspaces/${user.workspaceId}/files/folders`,
        '/api/copilot/chats',
        '/api/users/me/settings',
        '/api/auth/oauth/connections',
        '/api/desktop/inbox',
      ])
        await compile(path)
      for (const path of [
        '/api/mothership/chat/stop',
        '/api/mothership/chat/abort',
        '/api/desktop/devices',
        '/api/desktop/tool/authorize',
        '/api/desktop/tool/claim',
        '/api/desktop/tool/complete',
        '/api/copilot/confirm',
        '/api/files/uploads',
        '/api/files/uploads/warm-up/parts',
        '/api/files/uploads/warm-up/complete',
        `/api/workspaces/${user.workspaceId}/files/folders`,
      ])
        await compile(path, 'POST')
      await compile('/api/v2/uploads/warm-up', 'PUT')

      const file = writeFile(join(scratch, 'warm.txt'), 'warm')
      const folder = join(scratch, 'Warm folder')
      writeFile(join(folder, 'warm.txt'), 'warm')
      let proceed!: () => void
      const proceeding = new Promise<void>((resolve) => {
        proceed = resolve
      })
      agent.script(
        '[warm-up]',
        async (turn) => {
          turn.text('Warming up.')
          await proceeding
          turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
          turn.toolCall({
            toolName: 'import_local_files',
            args: { path: folder, targetWorkspaceId: user.workspaceId },
          })
          turn.pause()
        },
        (_resume, turn) => turn.complete('Warmed up.')
      )
      agent.script('[warm-stop]', async (turn) => {
        turn.text('Stopping soon.')
        // The leg stays open until Stop ends it.
        await turn.closed
      })
      const page = await openApp(user, 'Warm chat', COMPILE_MS)
      await send(page, '[warm-up] read and import', COMPILE_MS)
      await expect(page.getByText('Warming up.')).toBeVisible({ timeout: COMPILE_MS })
      // Leaving and reopening a chat while its turn runs re-attaches to the turn's stream.
      await openChat(page, user, 'Warm other chat', COMPILE_MS)
      await openChat(page, user, 'Warm chat', COMPILE_MS)
      proceed()
      await expect(page.getByText('Warmed up.')).toBeVisible({ timeout: 2 * COMPILE_MS })
      await send(page, '[warm-stop] wait for Stop', COMPILE_MS)
      await expect(page.getByText('Stopping soon.')).toBeVisible({ timeout: COMPILE_MS })
      await click(page, page.getByRole('button', { name: 'Stop generation' }), COMPILE_MS)
      await expect(page.getByRole('button', { name: 'Stop generation' })).toBeHidden({
        timeout: COMPILE_MS,
      })
      await proxy.settled(COMPILE_MS)
      await compile('/api/health?e2e=warm-up-done')
    } finally {
      await app?.close().catch(() => {})
      app = undefined
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  const chatPath = (user: SeededUser, title: string) =>
    `/workspace/${user.workspaceId}/chat/${user.chats[title]}`

  /** Launches the app signed in as `user`, showing the chat titled `title`. */
  async function openApp(user: SeededUser, title: string, timeout = 120_000): Promise<Page> {
    app = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: {
        ...process.env,
        SIM_DESKTOP_ORIGIN: proxy.origin,
        SIM_DESKTOP_USER_DATA: join(scratch, 'profile'),
      },
    })
    const page = await app.firstWindow({ timeout })
    pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    const signIn = new URL('/__e2e/sign-in', proxy.origin)
    signIn.searchParams.set('cookie', user.cookie)
    signIn.searchParams.set('to', chatPath(user, title))
    await page.goto(signIn.toString(), { waitUntil: 'commit', timeout })
    await expect(composer(page)).toBeVisible({ timeout })
    return page
  }

  const composer = (page: Page) => page.getByRole('textbox').last()

  /** The dev app's error overlay, if it is up, with the errors the window reported. */
  async function devOverlay(page: Page): Promise<{ text: string; consoleOnly: boolean } | null> {
    const overlay = page.locator('nextjs-portal [data-nextjs-dialog]')
    if ((await overlay.count()) === 0) return null
    const text = await overlay
      .first()
      .innerText()
      .catch(() => '')
    return {
      text: `${text}\n${pageErrors.join('\n')}`,
      consoleOnly: /^\s*Console Error/.test(text),
    }
  }

  /**
   * Clicks `target`. When the dev app's error overlay intercepts the click, a console-error notice
   * (dev-only chrome over a logged error) is dismissed and the click retried; a runtime error fails
   * at once with its message instead of waiting out a blocked click.
   */
  async function click(page: Page, target: Locator, timeout = 15_000): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await target.click({ timeout: attempt === 0 ? Math.min(timeout, 5_000) : timeout })
        return
      } catch (error) {
        const overlay = await devOverlay(page)
        if (overlay && !overlay.consoleOnly)
          throw new Error(`Next.js error overlay: ${overlay.text}`)
        if (overlay) await page.keyboard.press('Escape')
        else if (attempt > 0) throw error
      }
    }
  }

  /**
   * Sends `message` and waits for its turn to reach Sim. Before the page hydrates, typing or the
   * click can be lost: the Send button is missing or does nothing and the composer is not emptied,
   * and only then is the message typed and sent again. Once the UI takes the message (the
   * composer empties after the click), a turn that never reaches Sim is a lost send and fails.
   */
  async function send(page: Page, message: string, timeout = 60_000): Promise<void> {
    const since = Date.now()
    const deadline = since + timeout
    const sent = () =>
      proxy
        .seen(since)
        .some((entry) => entry.method === 'POST' && entry.path === '/api/mothership/chat')
    while (!sent()) {
      if (Date.now() > deadline)
        throw new Error(
          `The UI never took the message: ${message} (errors: ${pageErrors.join(' | ')})`
        )
      if ((await composer(page).inputValue()) !== message) await composer(page).fill(message)
      const clicked = await click(page, page.getByRole('button', { name: 'Send message' }), 5_000)
        .then(() => true)
        .catch((error: unknown) => {
          if (String(error).includes('Next.js error overlay')) throw error
          return false
        })
      if (!clicked) continue
      const taken = await expect
        .poll(() => composer(page).inputValue(), { timeout: 5_000 })
        .toBe('')
        .then(
          () => true,
          () => false
        )
      if (!taken) continue
      await expect
        .poll(sent, {
          timeout: Math.max(deadline - Date.now(), 30_000),
          message: `The UI took the message but its turn never reached Sim: ${message} (errors: ${pageErrors.join(' | ')})`,
        })
        .toBe(true)
    }
  }

  /** Switches chats in-app, the way the sidebar does, without reloading the page. */
  async function openChat(
    page: Page,
    user: SeededUser,
    title: string,
    timeout = 30_000
  ): Promise<void> {
    await click(page, page.getByRole('link', { name: title }).first(), timeout)
    await expect(page).toHaveURL(new RegExp(`${user.chats[title]}$`), { timeout })
  }

  /** The chat's first call as `status: error`, so a wrong terminal state says why. */
  async function callState(chatId: string): Promise<string> {
    const [call] = await db.toolCalls(chatId)
    return call ? `${call.status}: ${call.error ?? ''}` : 'no call'
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
  /** The chat turn's response stream, as the chat view reads it. */
  const isChatStream = (entry: { method: string; path: string }) =>
    entry.method === 'POST' && entry.path === '/api/mothership/chat'
  /** The background executor's report of a call's result. */
  const isDesktopCompletion = (method: string, path: string) =>
    method === 'POST' && path === DESKTOP_COMPLETION_PATH
  /** A client tool's report of its own result. */
  const isToolReport = (method: string, path: string) =>
    method === 'POST' && path === '/api/copilot/confirm'

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
    const marker = generateId()
    const file = writeFile(join(scratch, 'notes.txt'), `notes from disk ${marker}`)
    let callId = ''
    agent.script('[leave-read]', (turn) => {
      callId = turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
      turn.pause()
    })
    const page = await openApp(user, 'Read chat')
    // Visit the other chat once, so leaving for it later is a quick client-side switch.
    await openChat(page, user, 'Other chat')
    await openChat(page, user, 'Read chat')
    const claim = proxy.hold(isDesktopClaim)
    const since = Date.now()
    await send(page, '[leave-read] read my notes')
    await claim.arrival(ARRIVAL_MS, 'The read’s claim')
    const turnStream = proxy.seen(since).find(isChatStream)
    if (!turnStream) throw new Error('The turn’s stream never reached Sim')
    await click(page, page.getByRole('link', { name: 'Other chat' }).first())
    // The view let go of the turn's stream, the moment a read tied to that view would end.
    // Electron gives the held claim 8 s, so this waits only a few.
    await expect.poll(() => turnStream.clientClosedAt, { timeout: 6_000 }).toBeDefined()
    claim.release()
    await expect(page).toHaveURL(new RegExp(`${user.chats['Other chat']}$`), { timeout: 30_000 })

    await agent.waitForResume(() => Boolean(callId && agent.resultFor(callId)), 60_000)
    const result = agent.resultFor(callId)
    expect(result?.success).toBe(true)
    expect(JSON.stringify(result?.data)).toContain(marker)
    const [call] = await db.toolCalls(user.chats['Read chat'])
    expect(call).toMatchObject({ toolName: 'read_local_file', status: 'completed' })
  })

  test('an import keeps running across chat switches, and Stop from the reopened chat ends it', async () => {
    const user = await db.seedUser(['Import chat', 'Other chat'])
    const chatId = user.chats['Import chat']
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
    await firstUpload.arrival(ARRIVAL_MS, 'The first upload')

    await openChat(page, user, 'Other chat')
    await openChat(page, user, 'Import chat')
    const laterFolder = proxy.hold(isFolderCreate)
    firstUpload.release()
    // The import outlived both view changes: its first file landed.
    await expect
      .poll(
        async () =>
          `${(await db.workspaceFileNames(user.workspaceId)).join(',')} | ${await callState(chatId)}`,
        { timeout: 60_000 }
      )
      .toMatch(/^a\.txt /)
    await laterFolder.arrival(ARRIVAL_MS, 'The next folder')

    const stoppedAt = Date.now()
    await click(page, page.getByRole('button', { name: 'Stop generation' }))
    // Stop cancels the import's request in flight, which ends the import, and records the call as
    // cancelled; the stopped import reports nothing that could contest that record.
    await expect.poll(() => laterFolder.isAbandoned, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => callState(chatId), { timeout: 30_000 }).toMatch(/^cancelled/)
    laterFolder.release()
    expect(proxy.seen(stoppedAt).filter((entry) => isToolReport(entry.method, entry.path))).toEqual(
      []
    )
    const [call] = await db.toolCalls(chatId)
    expect(call).toMatchObject({ toolName: 'import_local_files', status: 'cancelled' })
    expect(await db.workspaceFolderNames(user.workspaceId)).not.toContain('later')
    expect(await db.workspaceFileNames(user.workspaceId)).toEqual(['a.txt'])
  })

  /** An import whose first upload the proxy holds until released, as a large file's would take. */
  async function slowImport(user: SeededUser, title: string, marker: string) {
    const source = importSource()
    let callId = ''
    agent.script(marker, (turn) => {
      callId = turn.toolCall({
        toolName: 'import_local_files',
        args: { path: source, targetWorkspaceId: user.workspaceId },
      })
      turn.pause()
    })
    const page = await openApp(user, title)
    const firstUpload = proxy.hold(isUploadStart)
    await send(page, `${marker} import my reports`)
    await firstUpload.arrival(ARRIVAL_MS, 'The first upload')
    return { page, firstUpload, callId: () => callId }
  }

  test('an import that runs longer than the default tool budget still completes', async () => {
    test.setTimeout(420_000)
    const user = await db.seedUser(['Long import chat', 'Other chat'])
    const chatId = user.chats['Long import chat']
    const { page, firstUpload, callId } = await slowImport(
      user,
      'Long import chat',
      '[long-import]'
    )
    // The import is alive and working past the 60 s default budget and its 30 s grace, while the
    // user is in another chat: its lease is renewed by the import, not by the chat view.
    await openChat(page, user, 'Other chat')
    await page.waitForTimeout(LONG_IMPORT_MS)
    expect(agent.resultFor(callId())).toBeUndefined()
    firstUpload.release()

    await agent.waitForResume(() => Boolean(agent.resultFor(callId())), 120_000)
    const result = agent.resultFor(callId())
    expect(JSON.stringify(result?.data)).not.toContain('outcomeUnknown')
    expect(result?.success).toBe(true)
    await expect
      .poll(() => db.workspaceFileNames(user.workspaceId), { timeout: 30_000 })
      .toEqual(['a.txt', 'b.txt'])
    expect(await callState(chatId)).toMatch(/^completed/)
  })

  test('a long import whose window crashed settles as outcome unknown about one lease later', async () => {
    test.setTimeout(420_000)
    const user = await db.seedUser(['Crashing import chat'])
    const { callId } = await slowImport(user, 'Crashing import chat', '[crash-import]')
    await sleep(LONG_IMPORT_MS)
    expect(agent.resultFor(callId())).toBeUndefined()
    // A crash reports nothing on its way out, unlike a closed window: only the lapse of the
    // lease the page was renewing tells Sim the import is gone.
    const crashedAt = Date.now()
    await app?.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents())
        if (contents.getURL().includes('/workspace/')) contents.forcefullyCrashRenderer()
    })
    await agent.waitForResume(() => Boolean(agent.resultFor(callId())), 150_000)
    const result = agent.resultFor(callId())
    expect(result?.data).toMatchObject({ outcomeUnknown: true })
    expect((result?.at ?? 0) - crashedAt).toBeLessThan(LEASE_MS + 20_000)
  })

  test('signing out ends a desktop tool still running', async () => {
    const user = await db.seedUser(['Import chat'])
    const chatId = user.chats['Import chat']
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
    await firstUpload.arrival(ARRIVAL_MS, 'The first upload')

    // The desktop reloads into the login page once signing out completes, which would end any
    // tool; holding the sign-out shows the tool ends at sign-out itself, not at that reload.
    const signOut = proxy.hold((method, path) => method === 'POST' && path === '/api/auth/sign-out')
    await click(page, page.getByRole('button', { name: user.name }))
    await click(page, page.getByRole('menuitem', { name: 'Sign out' }))
    await signOut.arrival(ARRIVAL_MS, 'The sign-out')
    await expect.poll(() => firstUpload.isAbandoned, { timeout: 15_000 }).toBe(true)
    const abandonedAt = Date.now()
    signOut.release()
    // The reload into the login page replaces the document, so nothing of the import can run after.
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
    firstUpload.release()
    // Between sign-out and that reload the cancelled import sent nothing more, not even a report.
    const toolRequests = proxy
      .seen(abandonedAt)
      .filter(
        (entry) =>
          isUploadStart(entry.method, entry.path) ||
          isFolderCreate(entry.method, entry.path) ||
          isToolReport(entry.method, entry.path)
      )
    expect(toolRequests).toEqual([])
    expect(await callState(chatId)).toMatch(/^running/)
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
    const secret = generateId()
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

  test("a terminal command awaiting the user's approval cannot be claimed", async () => {
    const user = await db.seedUser(['Approval chat'])
    const command = `touch '${join(scratch, 'terminal-ran')}'`
    agent.script('[unapproved-run]', (turn) => {
      turn.toolCall({ toolName: 'terminal', args: { operation: 'run', command } })
      turn.pause()
    })
    const page = await openApp(user, 'Approval chat')
    const chatId = user.chats['Approval chat']
    const run = await gatedCall(page, chatId, '[unapproved-run] run a command', 'terminal')

    // The guard is the claim: Sim must not hand an unapproved command to the desktop, so the call
    // stays pending and unclaimed. Whether a handed-over command then runs depends on a terminal
    // being open for the chat, which this test does not set up, so it checks the claim only.
    const response = await page.evaluate(
      ({ toolCallId, command }) =>
        (globalThis as DesktopWindow).simDesktop.terminal
          .executeTool(toolCallId, 'run', { command }, 'unapproved-e2e')
          .catch((error: unknown) => ({ ok: false, error: String(error) })),
      { toolCallId: run.toolCallId, command }
    )
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
    // Delivered to Sim on release even should Electron have given up on it meanwhile.
    const lateClaim = proxy.hold(isDesktopClaim, { deliverIfAbandoned: true })
    await send(page, '[stopped-claim] read my secret')
    const claim = await lateClaim.arrival(ARRIVAL_MS, 'The read’s claim')
    await click(page, page.getByRole('button', { name: 'Stop generation' }))
    // Stop settles the call nobody has claimed yet as never started.
    await expect.poll(() => callState(chatId), { timeout: 30_000 }).toMatch(/^cancelled/)
    lateClaim.release()
    // The claim held across Stop reaches Sim after it and is refused, and so is a replay of it.
    await expect.poll(() => claim.status, { timeout: 15_000 }).toBe(410)
    const [call] = await db.toolCalls(chatId)
    const replay = await page.evaluate(
      (toolCallId) =>
        (globalThis as DesktopWindow).simDesktop.localFiles?.({ operation: 'read', toolCallId }),
      call.toolCallId
    )
    expect(replay?.ok).toBe(false)
    const answered = () =>
      proxy.seen(claim.at, '/api/desktop/tool/authorize').filter((entry) => entry.status)
    await expect.poll(() => answered().length, { timeout: 15_000 }).toBeGreaterThan(0)
    for (const entry of answered()) expect(entry.status).toBe(410)
    const [after] = await db.toolCalls(chatId)
    expect(after).toMatchObject({ status: 'cancelled', claimedBy: null })
  })

  test('where Sim cannot run the background executor, the app stays dormant and a desktop round trip runs in the chat view', async () => {
    const user = await db.seedUser(['Round trip'])
    const marker = generateId()
    const file = writeFile(join(scratch, 'plan.txt'), `plan ${marker}`)
    const monitor = new RedisMonitor(sim.redisUrl)
    await monitor.start()
    try {
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
      // Each layer is checked on its own (soft), so a regression shows every layer it reaches:
      // the round trip, the turn's binding, the routes the app calls, and the doorbell.
      await expect
        .soft(page.getByText('The plan says go.'), 'foreground round trip')
        .toBeVisible({ timeout: 60_000 })
      expect.soft(agent.resultFor(callId)?.success, 'read result').toBe(true)

      // The app registers once signed out (refused) and again on sign-in.
      const registeredSignedIn = () =>
        proxy
          .seen(since, REGISTRATION_PATH)
          .some((entry) => entry.method === 'POST' && entry.status === 200)
      await expect.poll(registeredSignedIn, { timeout: 30_000 }).toBe(true)

      const runs = await db.runs(user.chats['Round trip'])
      expect(runs.length).toBeGreaterThan(0)
      expect
        .soft(
          runs.map((run) => run.desktopDeviceId),
          'turn binding'
        )
        .toEqual(runs.map(() => null))
      const [call] = await db.toolCalls(user.chats['Round trip'])
      expect
        .soft(call, 'foreground call')
        .toMatchObject({ toolName: 'read_local_file', status: 'completed' })
      expect.soft(call?.persistSeq, 'persist order').not.toBeNull()

      // Only registration and the foreground claim: no inbox, doorbell stream, executor claim,
      // lease or completion. The workspace's activity poll is Sim's page, not the app: this Sim
      // has Redis, so its page asks.
      const desktopRoutes = new Set(proxy.seen(since, '/api/desktop/').map((entry) => entry.path))
      desktopRoutes.delete(REGISTRATION_PATH)
      desktopRoutes.delete('/api/desktop/activity')
      expect
        .soft(desktopRoutes, 'desktop routes the app called')
        .toEqual(new Set(['/api/desktop/tool/authorize']))
      expect(monitor.lines.length).toBeGreaterThan(0)
      expect.soft(monitor.publishesTo('desktop:inbox'), 'doorbell').toEqual([])
    } finally {
      monitor.stop()
    }
  })

  test('in the background, a call issued after the user switched chats runs on the desktop', async () => {
    proxy.rewriteAnswer(REGISTRATION_PATH, undefined)
    const user = await db.seedUser(['Background chat', 'Other chat'])
    const marker = generateId()
    const file = writeFile(join(scratch, 'notes.txt'), `notes from disk ${marker}`)
    let issue!: () => void
    const issued = new Promise<void>((resolve) => {
      issue = resolve
    })
    let callId = ''
    let issuedAt = 0
    agent.script('[background-read]', async (turn) => {
      turn.text('Reading your notes.')
      await issued
      callId = turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
      issuedAt = Date.now()
      turn.pause()
    })
    const page = await openApp(user, 'Background chat')
    await send(page, '[background-read] read my notes')
    await expect(page.getByText('Reading your notes.')).toBeVisible({ timeout: 60_000 })
    await openChat(page, user, 'Other chat')
    issue()

    await agent.waitForResume(() => Boolean(callId && agent.resultFor(callId)), 60_000)
    const result = agent.resultFor(callId)
    expect(result?.success).toBe(true)
    expect(JSON.stringify(result?.data)).toContain(marker)
    // No pickup grace: the desktop, not the chat view the user left, ran it.
    expect((result?.at ?? 0) - issuedAt).toBeLessThan(PICKUP_GRACE_MS)
    const chatId = user.chats['Background chat']
    const runs = await db.runs(chatId)
    expect(runs.some((run) => run.desktopDeviceId !== null)).toBe(true)
    const [call] = await db.toolCalls(chatId)
    expect(call).toMatchObject({ toolName: 'read_local_file', status: 'completed' })
    expect(proxy.seen(issuedAt, '/api/desktop/tool/authorize')).toEqual([])
  })

  test('in the background, a result reported across a network cut reaches the agent exactly once', async () => {
    proxy.rewriteAnswer(REGISTRATION_PATH, undefined)
    const user = await db.seedUser(['Cut chat'])
    const chatId = user.chats['Cut chat']
    const marker = generateId()
    const file = writeFile(join(scratch, 'notes.txt'), `notes from disk ${marker}`)
    let callId = ''
    agent.script('[network-cut]', (turn) => {
      callId = turn.toolCall({ toolName: 'read_local_file', args: { path: file } })
      turn.pause()
    })
    const page = await openApp(user, 'Cut chat')
    // Reaches Sim on release although the cut made the app give up on it, as a report already on
    // the wire would: the app cannot know it landed, so it reports again once back online.
    const completion = proxy.hold(isDesktopCompletion, { deliverIfAbandoned: true })
    const answers = proxy.recordAnswers(DESKTOP_COMPLETION_PATH)
    await send(page, '[network-cut] read my notes')
    await completion.arrival(ARRIVAL_MS, 'The result report')

    proxy.cutNetwork()
    await expect.poll(() => completion.isAbandoned, { timeout: 15_000 }).toBe(true)
    completion.release()
    await expect.poll(() => callState(chatId), { timeout: 30_000 }).toMatch(/^completed/)
    // The late report alone resumed the agent while the app was still offline.
    await agent.waitForResume(() => Boolean(agent.resultFor(callId)), 60_000)
    const restoredAt = Date.now()
    proxy.restoreNetwork()

    // Back online, the app reopens its doorbell and reports the result again.
    await expect
      .poll(() => proxy.seen(restoredAt, '/api/desktop/inbox/stream').length, { timeout: 60_000 })
      .toBeGreaterThan(0)
    const retried = () =>
      proxy
        .seen(restoredAt)
        .filter((entry) => isDesktopCompletion(entry.method, entry.path) && entry.status)
    await expect.poll(() => retried().length, { timeout: 60_000 }).toBeGreaterThan(0)
    for (const entry of retried()) expect(entry.status).toBeLessThan(300)

    await proxy.settled(30_000)
    // Sim had already recorded the late report, so every retry the app heard back from is a no-op.
    expect(answers.length).toBeGreaterThan(0)
    expect(answers).toEqual(answers.map(() => expect.objectContaining({ outcome: 'duplicate' })))
    const delivered = agent.resumes.filter((resume) =>
      resume.results.some((entry) => entry.callId === callId)
    )
    expect(delivered).toHaveLength(1)
    expect(JSON.stringify(agent.resultFor(callId)?.data)).toContain(marker)
    const [call] = await db.toolCalls(chatId)
    expect(call).toMatchObject({ toolName: 'read_local_file', status: 'completed' })
  })
})
