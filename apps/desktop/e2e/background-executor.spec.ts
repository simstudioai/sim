import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { sleep } from '@sim/utils/helpers'
import {
  answerShellDialog,
  FixtureSim,
  journalState,
  launchAgainst,
  processRunning,
  readFileSafe,
  refFor,
  registeredDevice,
  settled,
  sha256,
  WORKSPACE,
} from './executor-sim'
import { type DesktopBridge, expect, test } from './harness'

/**
 * The Sim desktop app's background executor against a fixture Sim that speaks the executor's
 * device protocol (register, inbox, doorbell, claim, lease, complete, import) the way Sim's
 * routes do.
 * The window navigates, reloads and leaves the chats while their calls run: nothing in this
 * suite depends on a chat view, which is the point.
 */

/** Sim's window for a device to claim an offered call (DESKTOP_TOOL_PICKUP_GRACE_MS in Sim). */
const SIM_PICKUP_GRACE_MS = 15_000
/**
 * Long enough that only the doorbell can explain a prompt reaction: with jitter, the device's own
 * inbox reads come at least 24s apart.
 */
const SLOW_RECONCILE_MS = 30_000
const DOORBELL_REACTION_MS = 10_000

const CHAT_A = 'chat-browser-a'
const CHAT_B = 'chat-terminal-b'
const CHAT_C = 'chat-idle-c'

const sim = new FixtureSim()

type SleepBlockerProbe = typeof globalThis & { __heldSleepBlockers?: Map<number, string> }

/** Replaces the power blocker with one that records what is held, before any work arrives. */
async function stubSleepBlockers(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ powerSaveBlocker }) => {
    const held = new Map<number, string>()
    let next = 1
    ;(globalThis as SleepBlockerProbe).__heldSleepBlockers = held
    powerSaveBlocker.start = (type) => {
      held.set(next, type)
      return next++
    }
    powerSaveBlocker.stop = (id) => held.delete(id)
    powerSaveBlocker.isStarted = (id) => held.has(id)
  })
}

function heldSleepBlockers(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [
    ...((globalThis as SleepBlockerProbe).__heldSleepBlockers?.values() ?? []),
  ])
}

function offeredDevice(window: Page) {
  return window.evaluate(() =>
    (globalThis as DesktopBridge).simDesktop.desktopExecutor?.getDevice()
  )
}

/**
 * The user presses Tab in the agent's page. Resolves once Chromium has delivered the key to the
 * page, which is when the app records the input; `sendInputEvent` itself returns before that.
 */
async function userTypesInPage(app: ElectronApplication, pageUrl: string): Promise<void> {
  await app.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
    if (!page) throw new Error(`No page at ${pageUrl}`)
    const delivered = new Promise<void>((resolve) => {
      const onInput = (_event: unknown, input: { type: string }) => {
        if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return
        page.removeListener('input-event', onInput)
        resolve()
      }
      page.on('input-event', onInput)
    })
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await delivered
  }, pageUrl)
}

/** Inbox reads, without the doorbell stream. */
function inboxReads(): number {
  return sim.requests.filter((request) => request === 'GET /api/desktop/inbox').length
}

/**
 * Rings the doorbell and waits for the inbox read it causes. Reads never overlap, so once it
 * starts, every read before it, and whatever that read made the device do, has finished.
 */
async function nextInboxRead(deviceId: string): Promise<void> {
  const before = inboxReads()
  sim.ring(deviceId, 'approval')
  await expect.poll(inboxReads).toBeGreaterThan(before)
}

test.describe('background executor', () => {
  test.beforeAll(async () => {
    await sim.start()
  })

  test.afterEach(() => {
    sim.reset()
  })

  test.afterAll(async () => {
    await sim.stop()
  })

  test('A: two chats run browser and terminal work while the user is elsewhere and reloads', async ({
    desktop,
  }) => {
    const { app, window, userData } = await launchAgainst(desktop, sim)
    await stubSleepBlockers(app)
    const deviceId = await registeredDevice(sim)
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    await test.step('an enabled device offers itself for binding', async () => {
      expect(await offeredDevice(window)).toEqual({ deviceId, protocolVersion: 1 })
    })

    const marker = join(userData, 'terminal-marker.txt')
    const releaseCommands = join(userData, 'release-commands')
    const readable = join(userData, 'notes.txt')
    writeFileSync(readable, 'background read fixture')

    const button = await test.step('chat A opens its page in the background', async () => {
      const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', {
        url: `${sim.origin}/counter?chat=A`,
      })
      const completion = await settled(sim, opened)
      expect(completion.status, completion.message).toBe('success')
      return refFor((completion.data?.snapshot as { outline: string }).outline, 'Count visit')
    })

    const clicks = Array.from({ length: 10 }, () =>
      sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })
    )
    const terminalRuns = [1, 2, 3].map((n) =>
      sim.issue(deviceId, CHAT_B, 'terminal', {
        operation: 'run',
        args: {
          command: `until [ -e '${releaseCommands}' ]; do sleep 0.1; done; echo B-${n} >> '${marker}'`,
          waitSeconds: 30,
        },
      })
    )
    const readConsent = app.waitForEvent('window')
    const localRead = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
    try {
      await answerShellDialog(await readConsent, 'Allow folder')

      await window.goto(`${sim.origin}/workspace/ws-other/home`)
      await window.reload()
      await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

      // Chat B's first command holds its queue until released, so a claim that waited for the
      // calls ahead of it to run could never happen in time.
      await test.step("every call is claimed while chat B's first command still runs", async () => {
        await expect
          .poll(
            () =>
              [...sim.calls.values()]
                .filter((call) => call.claimedAt === undefined)
                .map((call) => call.toolCallId),
            { timeout: SIM_PICKUP_GRACE_MS }
          )
          .toEqual([])
        for (const call of sim.calls.values()) {
          expect(
            (call.claimedAt ?? Number.POSITIVE_INFINITY) - call.issuedAt,
            call.toolCallId
          ).toBeLessThan(SIM_PICKUP_GRACE_MS)
        }
      })

      await test.step('the lease is renewed while calls wait and run', async () => {
        await expect
          .poll(() => terminalRuns.filter((id) => sim.requireCall(id).renewals === 0))
          .toEqual([])
      })

      await test.step('the machine is kept awake while the commands run', async () => {
        await expect.poll(() => heldSleepBlockers(app)).toEqual(['prevent-app-suspension'])
      })
    } finally {
      writeFileSync(releaseCommands, '')
    }

    await test.step('every call completes exactly once with its own token', async () => {
      for (const id of [...clicks, ...terminalRuns, localRead]) {
        const completion = await settled(sim, id, 90_000)
        const call = sim.requireCall(id)
        expect(completion.status, `${call.toolName}: ${completion.message}`).toBe('success')
        expect(completion.outcome).toBe('recorded')
        expect(call.claims).toBe(1)
        expect(call.completions).toHaveLength(1)
      }
    })

    await test.step('the machine may sleep again once every result is delivered', async () => {
      await expect.poll(() => heldSleepBlockers(app)).toEqual([])
    })

    await test.step('the page saw each click exactly once', async () => {
      await expect.poll(() => sim.hits.get('A')).toBe(10)
    })

    await test.step('chat B ran each command once, in order, in its own terminal', async () => {
      expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['B-1', 'B-2', 'B-3'])
      const read = sim.requireCall(localRead).completions[0]
      expect(JSON.stringify(read?.data)).toContain('background read fixture')
    })

    await test.step("chat B cannot see chat A's tabs", async () => {
      const listed = sim.issue(deviceId, CHAT_B, 'browser_list_tabs', {})
      const completion = await settled(sim, listed)
      expect(JSON.stringify(completion.data)).not.toContain('/counter')
    })

    await test.step('no chat view authorized a call', async () => {
      expect(
        sim.requests.filter((request) => request.includes('/api/desktop/tool/authorize'))
      ).toEqual([])
    })
  })

  test('background file reads require consent and Stop cancels pending permission', async ({
    desktop,
  }) => {
    const { app, userData } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const readable = join(userData, 'private.txt')
    writeFileSync(readable, 'background consent fixture')

    await test.step('background read stays pending until folder consent', async () => {
      const shown = app.waitForEvent('window', { timeout: 10_000 })
      const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
      const prompt = await shown
      await expect(prompt.getByRole('button', { name: 'Allow folder', exact: true })).toBeVisible()
      expect(sim.requireCall(call).completions).toHaveLength(0)
      await answerShellDialog(prompt, "Don't allow")
      const completion = await settled(sim, call)
      expect(completion.status).toBe('error')
      expect(JSON.stringify(completion)).not.toContain('background consent fixture')
    })

    await test.step('Stop dismisses background consent without granting access', async () => {
      const shown = app.waitForEvent('window', { timeout: 10_000 })
      const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
      const prompt = await shown
      await expect(prompt.getByRole('button', { name: 'Allow folder', exact: true })).toBeVisible()
      sim.stopCall(call)
      await expect.poll(() => prompt.isClosed()).toBe(true)
      await settled(sim, call)
      expect(sim.requireCall(call).completions[0]?.outcome).toBe('superseded')
    })

    await test.step('approved background reads reuse the shared folder grant', async () => {
      const shown = app.waitForEvent('window', { timeout: 10_000 })
      const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
      const prompt = await shown
      await answerShellDialog(prompt, 'Allow folder')
      expect((await settled(sim, call)).status).toBe('success')
      const next = sim.issue(deviceId, CHAT_A, 'read_local_file', { path: readable })
      expect(JSON.stringify((await settled(sim, next)).data)).toContain(
        'background consent fixture'
      )
    })
  })

  test('background consent cannot grant access when Sim cannot verify the call', async ({
    desktop,
  }) => {
    const { app, userData } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const readable = join(userData, 'private.txt')
    writeFileSync(readable, 'offline consent fixture')

    const shown = app.waitForEvent('window')
    const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
    const prompt = await shown
    await expect(prompt.getByRole('button', { name: 'Allow folder', exact: true })).toBeVisible()
    sim.disconnect()
    await answerShellDialog(prompt, 'Allow folder')

    await test.step('offline approval returns an error', async () => {
      await expect.poll(() => journalState(app, call)).toBe('result')
      sim.reconnect()
      const completion = await settled(sim, call)
      expect(completion.status).toBe('error')
      expect(JSON.stringify(completion)).not.toContain('offline consent fixture')
    })

    await test.step('the approval left no grant behind', async () => {
      const nextPrompt = app.waitForEvent('window')
      const next = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
      await answerShellDialog(await nextPrompt, "Don't allow")
      expect((await settled(sim, next)).status).toBe('error')
    })
  })

  test('background consent does not reopen the main app after its windows are closed', async ({
    desktop,
  }) => {
    test.skip(process.platform !== 'darwin', 'The macOS app remains running without a window.')
    const { app, window, userData } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const readable = join(userData, 'private.txt')
    writeFileSync(readable, 'windowless consent fixture')
    await window.close()

    const shown = app.waitForEvent('window')
    const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
    const prompt = await shown
    await expect(prompt.getByRole('button', { name: 'Allow folder', exact: true })).toBeVisible()
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.getParentWindow() === null)
      )
    ).toEqual([true])
    await answerShellDialog(prompt, "Don't allow")
    expect((await settled(sim, call)).status).toBe('error')
  })

  test('sign-out clears folder grants even when desktop settings cannot be saved', async ({
    desktop,
  }) => {
    const { app, window, userData } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const readable = join(userData, 'private.txt')
    writeFileSync(readable, 'cleanup consent fixture')
    const shown = app.waitForEvent('window')
    const call = sim.issue(deviceId, CHAT_B, 'read_local_file', { path: readable })
    await answerShellDialog(await shown, 'Allow folder')
    expect((await settled(sim, call)).status).toBe('success')
    const grants = join(userData, 'local-filesystem-grants.json')
    expect(existsSync(grants)).toBe(true)
    await window.evaluate(() => {
      const button = document.createElement('button')
      button.textContent = 'Enable full file access'
      button.onclick = async () => {
        await (globalThis as DesktopBridge).simDesktop.settings.setFullFileAccess?.(true)
        button.textContent = 'Full file access enabled'
      }
      document.body.append(button)
    })
    await window.getByRole('button', { name: 'Enable full file access', exact: true }).click()
    await expect(
      window.getByRole('button', { name: 'Full file access enabled', exact: true })
    ).toBeVisible()
    const settings = join(userData, 'settings.json')
    if (existsSync(settings)) renameSync(settings, `${settings}.backup`)
    mkdirSync(settings)

    try {
      const failedSignOut = app.waitForEvent('window')
      await app.evaluate(({ Menu }) => {
        const item = Menu.getApplicationMenu()
          ?.items.flatMap((entry) => entry.submenu?.items ?? [])
          .find((entry) => entry.label === 'Sign Out')
        if (!item) throw new Error('Missing Sign Out menu item')
        item.click()
      })
      await answerShellDialog(await failedSignOut, 'OK')
      expect(existsSync(join(userData, 'account-data-teardown-required.json'))).toBe(true)
      await expect.poll(() => existsSync(grants)).toBe(false)
    } finally {
      // The app saves its settings again as it quits.
      rmSync(settings, { recursive: true, force: true })
      if (existsSync(`${settings}.backup`)) renameSync(`${settings}.backup`, settings)
    }
  })

  test('B: a result produced while the network is cut is delivered once after reconnecting', async ({
    desktop,
  }) => {
    const { app } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: 'sleep 2; echo offline-done', waitSeconds: 30 },
    })
    await expect.poll(() => sim.requireCall(run).claims).toBe(1)
    sim.disconnect()

    await test.step('the cut drops the doorbell, and the result waits on the machine', async () => {
      await expect.poll(() => sim.streams.get(deviceId)?.size ?? 0).toBe(0)
      await expect.poll(() => journalState(app, run), { timeout: 30_000 }).toBe('result')
      await expect.poll(() => sim.droppedWhileOffline, { timeout: 15_000 }).toBeGreaterThan(0)
      expect(sim.requireCall(run).completions).toHaveLength(0)
    })
    sim.reconnect()

    await test.step('the result arrives once after reconnecting', async () => {
      const completion = await settled(sim, run, 60_000)
      expect(completion.status, completion.message).toBe('success')
      expect(JSON.stringify(completion.data)).toContain('offline-done')
      // Forgotten only once Sim acknowledged it, so nothing is left to send again.
      await expect.poll(() => journalState(app, run)).toBeUndefined()
      expect(sim.requireCall(run).completions).toHaveLength(1)
      expect(sim.requireCall(run).claims).toBe(1)
    })

    await test.step('the device reopens its doorbell and picks up new work', async () => {
      await expect.poll(() => sim.streams.get(deviceId)?.size ?? 0, { timeout: 45_000 }).toBe(1)
      const after = sim.issue(deviceId, CHAT_B, 'browser_list_tabs', {})
      const completion = await settled(sim, after)
      expect(completion.status, completion.message).toBe('success')
    })
  })

  test('C: a crash mid-command reports the outcome as unknown and never reruns it', async ({
    desktop,
  }) => {
    const first = await launchAgainst(desktop, sim)
    const marker = join(first.userData, 'crash-marker.txt')
    const deviceId = await registeredDevice(sim)

    const run = sim.issue(deviceId, CHAT_B, 'terminal', {
      operation: 'run',
      args: { command: `echo started >> '${marker}'; sleep 40`, waitSeconds: 60 },
    })
    await expect.poll(() => readFileSafe(marker), { timeout: 30_000 }).toContain('started')
    first.child.kill('SIGKILL')
    sim.streams.get(deviceId)?.clear()

    await launchAgainst(desktop, sim, { userData: first.userData })

    await test.step('the restarted app reports the lost result as outcome unknown', async () => {
      const completion = await settled(sim, run, 60_000)
      expect(completion.data).toMatchObject({ outcomeUnknown: true, doNotRetry: true })
    })

    await test.step('the command ran exactly once', async () => {
      expect(sim.requireCall(run).claims).toBe(1)
      expect(readFileSafe(marker).trim().split('\n')).toEqual(['started'])
    })
  })

  test('D: a folder import lands in Sim while the user is in another chat', async ({ desktop }) => {
    const { app, window, userData } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const source = join(userData, 'Reports')
    mkdirSync(join(source, 'q3'), { recursive: true })
    writeFileSync(join(source, 'notes.txt'), 'remember the numbers')
    // Larger than one 8 MB read, so the file crosses Electron in several chunks.
    const large = Buffer.alloc(9 * 1024 * 1024, 7)
    writeFileSync(join(source, 'q3', 'export.bin'), large)
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)

    const importConsent = app.waitForEvent('window')
    const call = sim.issue(deviceId, CHAT_B, 'import_local_files', {
      path: source,
      targetWorkspaceId: WORKSPACE,
      folderId: 'folder-e2e',
    })

    await answerShellDialog(await importConsent, 'Allow folder')

    await test.step('the import completes with every entry it stored', async () => {
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

    await test.step('Sim received the tree with the bytes on disk, once', async () => {
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

  test('E: Stop from another chat stops a running browser wait and terminal command', async ({
    desktop,
  }) => {
    sim.reconcileMs = SLOW_RECONCILE_MS
    await launchAgainst(desktop, sim)
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

    await test.step('both stopped calls are acknowledged through the doorbell', async () => {
      for (const call of [wait, run]) {
        const completion = await settled(sim, call, DOORBELL_REACTION_MS)
        expect(completion.outcome).toBe('superseded')
        expect(completion.at - stoppedAt).toBeLessThan(DOORBELL_REACTION_MS)
      }
    })

    await test.step('the stopped command no longer runs on the machine', async () => {
      await expect.poll(() => processRunning(command), { timeout: 10_000 }).toBe(false)
    })
  })

  test('F: a call held for approval in a background chat notifies, runs only once approved, and never once declined', async ({
    desktop,
  }) => {
    sim.reconcileMs = SLOW_RECONCILE_MS
    const { app, userData } = await launchAgainst(desktop, sim)
    await app.evaluate(({ Notification }) => {
      const shown: Array<{ title: string; body: string }> = []
      ;(
        globalThis as typeof globalThis & { __shownNotifications?: typeof shown }
      ).__shownNotifications = shown
      Notification.prototype.show = function show(this: { title: string; body: string }) {
        shown.push({ title: this.title, body: this.body })
      }
    })
    const shownNotifications = () =>
      app.evaluate(
        () =>
          (globalThis as { __shownNotifications?: Array<{ title: string; body: string }> })
            .__shownNotifications ?? []
      )
    const deviceId = await registeredDevice(sim)
    const marker = join(userData, 'declined-marker.txt')

    const approved = sim.issue(
      deviceId,
      CHAT_B,
      'terminal',
      { operation: 'run', args: { command: 'echo approved-run', waitSeconds: 30 } },
      'awaiting_approval'
    )
    const declined = sim.issue(
      deviceId,
      CHAT_B,
      'terminal',
      { operation: 'run', args: { command: `echo ran >> '${marker}'`, waitSeconds: 30 } },
      'awaiting_approval'
    )

    await test.step('the user is notified of each call, without its command', async () => {
      await expect.poll(shownNotifications, { timeout: 15_000 }).toHaveLength(2)
      const shown = JSON.stringify(await shownNotifications())
      expect(shown).not.toContain('approved-run')
      expect(shown).not.toContain('declined-marker')
    })

    await test.step('nothing is claimed while the calls wait for approval', async () => {
      await nextInboxRead(deviceId)
      expect(sim.requireCall(approved).claimAttempts).toBe(0)
      expect(sim.requireCall(declined).claimAttempts).toBe(0)
    })

    sim.decline(declined)
    sim.approve(approved)
    const decidedAt = Date.now()

    await test.step('the approved call is claimed through the doorbell and runs once', async () => {
      const completion = await settled(sim, approved)
      expect((sim.requireCall(approved).claimedAt ?? 0) - decidedAt).toBeLessThan(
        DOORBELL_REACTION_MS
      )
      expect(sim.requireCall(approved).claims).toBe(1)
      expect(JSON.stringify(completion.data)).toContain('approved-run')
    })

    await test.step('the declined call is never claimed, and its command never runs', async () => {
      await nextInboxRead(deviceId)
      // Attempts, not successful claims: the fixture refuses a declined call's claim itself.
      expect(sim.requireCall(declined).claimAttempts).toBe(0)
      expect(sim.requireCall(declined).completions).toEqual([])
      expect(readFileSafe(marker)).toBe('')
    })
  })

  test('H: a device Sim has not enabled offers no binding', async ({ desktop }) => {
    sim.enabled = false
    const { window, output } = await launchAgainst(desktop, sim, { env: { LOG_LEVEL: 'INFO' } })
    await window.goto(`${sim.origin}/workspace/${WORKSPACE}/chat/${CHAT_C}`)
    // Logged once the app has acted on Sim's answer, so the device read below is the settled one.
    await expect.poll(output, { timeout: 30_000 }).toContain('Desktop executor registered')

    expect(await offeredDevice(window)).toBeNull()
  })

  test('I: the agent yields its page while the user works in it, then takes it back', async ({
    desktop,
  }) => {
    const { app } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const pageUrl = `${sim.origin}/counter?chat=I`
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', { url: pageUrl })
    const outline = ((await settled(sim, opened)).data?.snapshot as { outline: string }).outline
    const button = refFor(outline, 'Count visit')

    await userTypesInPage(app, pageUrl)
    const lastUserInputAt = Date.now()
    const click = sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })

    const completion = await settled(sim, click, 30_000)
    expect(completion.status, completion.message).toBe('success')
    expect(completion.at - lastUserInputAt).toBeGreaterThanOrEqual(3_000)
    await expect.poll(() => sim.hits.get('I')).toBe(1)
  })

  test('I: an action the user never stops working long enough for does not run', async ({
    desktop,
  }) => {
    const { app } = await launchAgainst(desktop, sim)
    const deviceId = await registeredDevice(sim)
    const pageUrl = `${sim.origin}/counter?chat=I2`
    const opened = sim.issue(deviceId, CHAT_A, 'browser_open_url', { url: pageUrl })
    const outline = ((await settled(sim, opened)).data?.snapshot as { outline: string }).outline
    const button = refFor(outline, 'Count visit')

    await userTypesInPage(app, pageUrl)
    const click = sim.issue(deviceId, CHAT_A, 'browser_click', { elementId: button })
    let typing = true
    // A keypress a second, well inside the quiet the agent waits for before it acts.
    const keepTyping = (async () => {
      while (typing) {
        await userTypesInPage(app, pageUrl)
        await sleep(1_000)
      }
    })()

    try {
      const completion = await settled(sim, click, 60_000)
      expect(completion.status).toBe('error')
      expect(completion.message).toContain('Not run: the user kept working in this page')
      expect(completion.data).not.toMatchObject({ outcomeUnknown: true })
      expect(sim.hits.get('I2') ?? 0).toBe(0)
    } finally {
      typing = false
      await keepTyping
    }
  })
})
