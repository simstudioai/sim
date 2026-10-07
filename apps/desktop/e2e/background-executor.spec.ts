import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import {
  type FixtureCall,
  FixtureSim,
  launch,
  processRunning,
  RECONCILE_MS,
  readFileSafe,
  refFor,
  registeredDevice,
  settled,
  sha256,
  WORKSPACE,
} from './executor-sim'

/**
 * The Sim desktop app's background executor against a fixture Sim that speaks the executor's
 * device protocol (register, inbox, doorbell, claim, lease, complete, import) the way Sim's
 * routes do.
 * The window navigates, reloads and leaves the chats while their calls run: nothing in this
 * suite depends on a chat view, which is the point. Each scenario's checks land in a JSON
 * report at BACKGROUND_EXECUTOR_REPORT_PATH.
 */

const CHAT_A = 'chat-browser-a'
const CHAT_B = 'chat-terminal-b'
const CHAT_C = 'chat-idle-c'

interface ReportCheck {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

const report: ReportCheck[] = []

const sim = new FixtureSim()

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
    const launched = await launch(sim, userData)
    app = launched.app
    const window = launched.window
    const deviceId = await registeredDevice(sim)
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    const marker = join(userData, 'terminal-marker.txt')
    const readable = join(userData, 'notes.txt')
    writeFileSync(readable, 'background read fixture')

    await check('A: chat A opens its page in the background', async () => {
      const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
        url: `${sim.origin}/counter?chat=A`,
      })
      const completion = await settled(sim, opened)
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
        const completion = await settled(sim, id, 90_000)
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
      const completion = await settled(sim, listed)
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
    app = (await launch(sim, userData)).app
    const deviceId = await registeredDevice(sim)

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
      const completion = await settled(sim, run, 60_000)
      expect(completion.status).toBe('success')
      expect(JSON.stringify(completion.data)).toContain('offline-done')
      await sleep(3_000)
      expect(sim.requireCall(run).completions).toHaveLength(1)
    })
  })

  test('C: a crash mid-command reports the outcome as unknown and never reruns it', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-c-'))
    const marker = join(userData, 'crash-marker.txt')
    const first = await launch(sim, userData)
    const deviceId = await registeredDevice(sim)

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: `echo started >> '${marker}'; sleep 40`, waitSeconds: 60 },
    })
    await expect.poll(() => readFileSafe(marker), { timeout: 30_000 }).toContain('started')
    first.app.process().kill('SIGKILL')
    sim.streams.get(deviceId)?.clear()

    app = (await launch(sim, userData)).app

    await check('C: the restarted app reports the lost result as outcome unknown', async () => {
      const completion = await settled(sim, run, 60_000)
      expect(completion.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
    })

    await check('C: the command ran exactly once', async () => {
      expect(sim.requireCall(run).claims).toBe(1)
      expect(readFileSafe(marker).trim().split('\n')).toEqual(['started'])
    })
  })

  test('D: a folder import lands in Sim while the user is in another chat', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-d-'))
    const launched = await launch(sim, userData)
    app = launched.app
    const deviceId = await registeredDevice(sim)
    const source = join(userData, 'Reports')
    mkdirSync(join(source, 'q3'), { recursive: true })
    writeFileSync(join(source, 'notes.txt'), 'remember the numbers')
    // Larger than one 8 MB read, so the file crosses Electron in several chunks.
    const large = Buffer.alloc(9 * 1024 * 1024, 7)
    writeFileSync(join(source, 'q3', 'export.bin'), large)
    await launched.window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    const call = sim.issue(deviceId, CHAT_B, 'import_local_files', {
      path: source,
      targetWorkspaceId: WORKSPACE,
      folderId: 'folder-e2e',
    })

    await check('D: the import completes with every entry it stored', async () => {
      const completion = await settled(sim, call, 60_000)
      expect(completion.status).toBe('success')
      expect(completion.data).toMatchObject({
        success: true,
        workspaceId: WORKSPACE,
        folders: [
          { id: 'entry-1', relativePath: '' },
          { id: 'entry-3', relativePath: 'q3' },
        ],
        files: [
          { id: 'entry-2', relativePath: 'notes.txt' },
          { id: 'entry-4', relativePath: 'q3/export.bin' },
        ],
      })
    })

    await check('D: Sim received the tree with the bytes on disk, once', async () => {
      expect(sim.imported).toEqual([
        { toolCallId: call, kind: 'directory', sourceName: 'Reports', relativePath: '' },
        {
          toolCallId: call,
          kind: 'file',
          sourceName: 'Reports',
          relativePath: 'notes.txt',
          sha256: sha256(Buffer.from('remember the numbers')),
          bytes: 20,
        },
        { toolCallId: call, kind: 'directory', sourceName: 'Reports', relativePath: 'q3' },
        {
          toolCallId: call,
          kind: 'file',
          sourceName: 'Reports',
          relativePath: 'q3/export.bin',
          sha256: sha256(large),
          bytes: large.length,
        },
      ])
      expect(sim.requireCall(call).claims).toBe(1)
    })
  })

  test('E: Stop from another chat stops a running browser wait and terminal command', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'sim-executor-e-'))
    app = (await launch(sim, userData)).app
    const deviceId = await registeredDevice(sim)

    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=E`,
    })
    await settled(sim, opened)
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
      await settled(sim, wait, 10_000)
      await settled(sim, run, 15_000)
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
    app = (await launch(sim, userData)).app
    await app.evaluate(({ Notification }) => {
      const shown: Array<{ title: string; body: string }> = []
      const target = globalThis as typeof globalThis & { __shownNotifications?: typeof shown }
      target.__shownNotifications = shown
      Notification.prototype.show = function show(this: { title: string; body: string }) {
        shown.push({ title: this.title, body: this.body })
      }
    })
    const deviceId = await registeredDevice(sim)

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
      const completion = await settled(sim, gated)
      expect((sim.requireCall(gated).claimedAt ?? 0) - approvedAt).toBeLessThan(1_500)
      expect(JSON.stringify(completion.data)).toContain('approved-run')
    })
  })

  test('G: only the device a turn is bound to claims its calls', async () => {
    const first = await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-g1-')))
    const firstDevice = await registeredDevice(sim)
    const second = await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-g2-')))
    const secondDevice = await registeredDevice(sim, new Set([firstDevice]))
    app = first.app

    const call = sim.issue(firstDevice, CHAT_A, 'browser_list_tabs', {})
    await check('G: the bound device runs it and the other never claims it', async () => {
      await settled(sim, call)
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
    const launched = await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-h-')))
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
    const enabled = await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-h2-')))
    app = enabled.app
    const deviceId = await registeredDevice(sim)
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
    app = (await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-i-')))).app
    const deviceId = await registeredDevice(sim)
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=I`,
    })
    const outline = ((await settled(sim, opened)).data?.snapshot as { outline: string }).outline
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
      const completion = await settled(sim, click, 30_000)
      expect(completion.status, completion.message).toBe('success')
      expect(completion.at - lastUserInputAt).toBeGreaterThanOrEqual(3_000)
      await expect.poll(() => sim.hits.get('I')).toBe(1)
    })
  })

  test('I: an action the user never stops working long enough for does not run', async () => {
    app = (await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-i2-')))).app
    const deviceId = await registeredDevice(sim)
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
      url: `${sim.origin}/counter?chat=I2`,
    })
    const outline = ((await settled(sim, opened)).data?.snapshot as { outline: string }).outline
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
      const completion = await settled(sim, click, 60_000)
      typing = false
      await keepTyping
      expect(completion.status).toBe('error')
      expect(completion.message).toContain('Not run: the user kept working in this page')
      expect(completion.data).not.toMatchObject({ outcomeUnknown: true })
      expect(sim.hits.get('I2') ?? 0).toBe(0)
    })
  })

  test('J: the machine stays awake only while a chat has work running', async () => {
    app = (await launch(sim, mkdtempSync(join(tmpdir(), 'sim-executor-j-')))).app
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
    const deviceId = await registeredDevice(sim)
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
      await settled(sim, run)
      await expect
        .poll(sleepLog, { timeout: 10_000 })
        .toEqual(['start:prevent-app-suspension', 'stop'])
    })
  })
})
