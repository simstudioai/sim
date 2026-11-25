import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { randomInt } from '@sim/utils/random'
import {
  type ExecutorApp,
  FixtureSim,
  launchAgainst,
  processRunning,
  registeredDevice,
  settled,
} from './executor-sim'
import { type DesktopBridge, type DesktopFixture, expect, test } from './harness'

/**
 * Stopping the agent's terminal commands in the real app, with real shells and a real tmux
 * server: Stop, sign-out (by the web app's logout and by the session cookie going away), switching
 * Terminal off, and the launch-time recovery of an interrupted sign-out. What is asserted is the
 * machine's own state (which processes still run, which tmux panes still exist), never which
 * calls were made.
 *
 * Agent commands in a plain shell ignore SIGHUP, SIGINT and SIGTERM, so closing the shell cannot
 * end them by accident: only Sim's own stop, which escalates to SIGKILL on the command's process
 * group, does. The user's commands ignore the same signals, so a stop that reached them would
 * show. Each test gets its own tmux server (TMUX_TMPDIR), which the app's shells and its tmux
 * calls inherit. The tmux scenarios skip where tmux is not installed, except in CI, which
 * installs it.
 */

const CHAT_PLAIN = 'chat-cancel-plain'
const CHAT_TMUX = 'chat-cancel-tmux'
const TMUX_SESSION = 'agent-e2e'
/** Commands that only a SIGKILL ends, so a shell closing around them proves nothing. */
const STUBBORN = "trap '' HUP INT TERM"

const sim = new FixtureSim()

/** The shells, sleeps and tmux processes running, for a failure about who started what. */
function processes(): string {
  try {
    return execFileSync('ps', ['-eo', 'pid,ppid,pgid,args'])
      .toString()
      .split('\n')
      .filter((line) => /tmux|sleep|bash|zsh/.test(line))
      .join('\n')
  } catch (error) {
    return String(error)
  }
}
const REAL_TMUX = findTmux()

/**
 * Unique to this run of the suite, so its processes are never confused with those of another run on
 * the same machine (CI boxes run several at once).
 */
const RUN_NONCE = String(randomInt(0, 1_000_000)).padStart(6, '0')

/** A sleep that runs for about `seconds` and that only this test names. */
function slept(seconds: number): string {
  return `sleep ${seconds}.${RUN_NONCE}`
}

/** The command line a stubborn sleep runs as, unique to one test by its duration. */
function stubborn(seconds: number): string {
  return `bash -c "${STUBBORN}; ${slept(seconds)}"`
}

function findTmux(): string | null {
  try {
    return execFileSync('sh', ['-c', 'command -v tmux']).toString().trim() || null
  } catch {
    return null
  }
}

function requireTmux(): void {
  test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
}

/** One test's own tmux server, and a way to read and reshape it as the user would. */
class TmuxServer {
  /** Short and under /tmp: the server's socket path must fit in 104 bytes. */
  readonly dir = mkdtempSync('/tmp/sim-tmux-')

  run(args: string[]): string {
    return execFileSync(REAL_TMUX ?? 'tmux', args, {
      env: { ...process.env, TMUX_TMPDIR: this.dir },
    }).toString()
  }

  /** Every pane: its id, its run tag (empty when untagged) and the command it was started with. */
  panes(): Array<{ id: string; runId: string; command: string }> {
    try {
      return this.run([
        'list-panes',
        '-a',
        '-F',
        '#{pane_id}\t#{@sim-run-id}\t#{pane_start_command}',
      ])
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [id = '', runId = '', command = ''] = line.split('\t')
          return { id, runId, command }
        })
    } catch {
      return []
    }
  }

  /** The panes agent runs opened, found by the run script they were started with. */
  runPanes(): Array<{ id: string; runId: string }> {
    return this.panes().filter((pane) => pane.command.includes('run.sh'))
  }

  hasPane(id: string): boolean {
    return this.panes().some((pane) => pane.id === id)
  }

  /** The user splits a pane of their own beside the agent's, running their own command. */
  split(target: string, command: string): string {
    return this.run(['split-window', '-d', '-t', target, '-P', '-F', '#{pane_id}', command]).trim()
  }

  clients(): number {
    try {
      return this.run(['list-clients']).trim().split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  remove(): void {
    try {
      this.run(['kill-server'])
    } catch {
      // Already gone.
    }
    rmSync(this.dir, { recursive: true, force: true })
  }
}

/** A `tmux` ahead of the real one on PATH that refuses pane options, as tmux before 3.0 does. */
function oldTmuxPath(desktop: DesktopFixture): string {
  const dir = desktop.tempDir('sim-old-tmux-')
  const binary = join(dir, 'tmux')
  writeFileSync(
    binary,
    `#!/bin/sh
if [ "$1" = set-option ] && [ "$2" = -p ]; then
  printf 'tmux: unknown option -- p\\nusage: set-option [-aFgosquw] [-t target-window] option [value]\\n' >&2
  exit 1
fi
exec ${JSON.stringify(REAL_TMUX)} "$@"
`
  )
  chmodSync(binary, 0o755)
  return `${dir}:${process.env.PATH ?? ''}`
}

function bridge(window: Page) {
  return {
    /** The user opens a terminal tab in a chat's terminal panel and starts a command in it. */
    async userRuns(scope: string, command: string): Promise<void> {
      const terminalId = await window.evaluate(async (scopeId) => {
        const terminal = (globalThis as DesktopBridge).simDesktop.terminal
        await terminal.activateScope(scopeId)
        terminal.setVisible?.(true, scopeId)
        terminal.setFocused(true, scopeId)
        const opened = await terminal.openTerminal(undefined, scopeId)
        return opened.activeTerminalId
      }, scope)
      if (!terminalId) throw new Error('No terminal tab opened')
      // Typing is gated on a real keypress in the window, as it is for the panel's own input.
      await window.keyboard.press('Shift')
      await window.evaluate(
        ([id, text, scopeId]) =>
          (globalThis as DesktopBridge).simDesktop.terminal.write(id, text, scopeId),
        [terminalId, `${command}\r`, scope] as const
      )
    },
    /** The user puts a chat away: its terminals close, though tmux runs started in them go on. */
    async putAway(scope: string): Promise<boolean> {
      return window.evaluate(async (scopeId) => {
        const terminal = (globalThis as DesktopBridge).simDesktop.terminal
        await terminal.activateScope(scopeId)
        return terminal.suspendScope(scopeId)
      }, scope)
    },
    async setTerminalEnabled(enabled: boolean): Promise<void> {
      await window.evaluate(
        (value) =>
          (globalThis as DesktopBridge).simDesktop.settings.setPreference('terminalEnabled', value),
        enabled
      )
    },
  }
}

/** The agent runs a plain-shell command in a chat's terminal; resolves once it is running. */
async function agentRunsPlain(deviceId: string, seconds: number): Promise<string> {
  const call = sim.issue(deviceId, CHAT_PLAIN, 'terminal', {
    operation: 'run',
    args: { command: stubborn(seconds), waitSeconds: 120 },
  })
  await expect.poll(() => processRunning(slept(seconds)), { timeout: 30_000 }).toBe(true)
  return call
}

/** The user starts a stubborn command in a tab of their own; resolves once it is running. */
async function userRunsPlain(window: Page, seconds: number): Promise<void> {
  await bridge(window).userRuns(CHAT_PLAIN, stubborn(seconds))
  await expect.poll(() => processRunning(slept(seconds)), { timeout: 30_000 }).toBe(true)
}

/** The agent starts a tmux client in its chat's terminal, so its runs go to tmux panes. */
async function agentAttachesTmux(deviceId: string, tmux: TmuxServer): Promise<void> {
  const before = tmux.clients()
  sim.issue(deviceId, CHAT_TMUX, 'terminal', {
    operation: 'run',
    args: { command: `tmux new-session -A -s ${TMUX_SESSION}`, waitSeconds: 2 },
  })
  await expect.poll(() => tmux.clients(), { timeout: 30_000 }).toBe(before + 1)
  // The terminal remembers for a few seconds that it was not in tmux. Listing panes only works
  // once it sees the attachment, and the run that follows then goes to tmux as well.
  await expect
    .poll(
      async () => {
        const probe = sim.issue(deviceId, CHAT_TMUX, 'terminal', { operation: 'panes', args: {} })
        return (await settled(sim, probe)).status
      },
      { timeout: 30_000 }
    )
    .toBe('success')
}

/**
 * The agent runs a command in tmux, which gives it its own tagged pane; with a short
 * `waitSeconds` the call hands it back as still running, with that pane.
 */
async function agentRunsInTmux(
  deviceId: string,
  tmux: TmuxServer,
  seconds: number,
  waitSeconds = 120
): Promise<{ call: string; pane: { id: string; runId: string } }> {
  await agentAttachesTmux(deviceId, tmux)
  return agentRunsInAttachedTmux(deviceId, tmux, seconds, waitSeconds)
}

/** {@link agentRunsInTmux} in a chat terminal that is already attached. */
async function agentRunsInAttachedTmux(
  deviceId: string,
  tmux: TmuxServer,
  seconds: number,
  waitSeconds: number
): Promise<{ call: string; pane: { id: string; runId: string } }> {
  const known = new Set(tmux.runPanes().map((pane) => pane.id))
  // It ignores Ctrl-C, so stopping it takes closing its pane, the step that must spare the user's.
  const call = sim.issue(deviceId, CHAT_TMUX, 'terminal', {
    operation: 'run',
    args: {
      command: `bash -c "trap '' INT; echo collect-me; ${slept(seconds)}"`,
      waitSeconds,
    },
  })
  await expect.poll(() => processRunning(slept(seconds)), { timeout: 30_000 }).toBe(true)
  const newPane = () => tmux.runPanes().find((pane) => !known.has(pane.id))
  await expect.poll(newPane, { timeout: 10_000 }).toBeTruthy()
  return { call, pane: newPane() as { id: string; runId: string } }
}

async function claimed(call: string): Promise<void> {
  await expect.poll(() => sim.requireCall(call).claims, { timeout: 30_000 }).toBe(1)
}

/** The runs this app has recorded for a later process to find. */
function recordedRuns(userData: string): string[] {
  try {
    return readdirSync(join(userData, 'terminal-runs'))
  } catch {
    return []
  }
}

/** Where a recorded run stands: `started`, or `delivered` once the model has its pane. */
function recordedRunState(userData: string, runId: string): unknown {
  try {
    return JSON.parse(readFileSync(join(userData, 'terminal-runs', `${runId}.json`), 'utf8')).state
  } catch {
    return undefined
  }
}

test.describe('terminal cancel', () => {
  let tmux: TmuxServer
  let launched: ExecutorApp[] = []
  const leftovers: string[] = []

  test.beforeAll(async () => {
    await sim.start()
  })

  test.beforeEach(() => {
    // CI installs tmux, so a runner without it fails instead of quietly skipping half the suite.
    if (process.env.CI) expect(REAL_TMUX, 'tmux is not installed').not.toBeNull()
    tmux = new TmuxServer()
  })

  test.afterEach(async ({ desktop }) => {
    const testInfo = test.info()
    if (testInfo.status !== testInfo.expectedStatus) {
      // What each call came back with, and the panes tmux held, explain most failures.
      const calls = [...sim.calls.values()].map((call) => ({
        toolCallId: call.toolCallId,
        args: call.args,
        status: call.status,
        completions: call.completions.map(({ status, message, data }) => ({
          status,
          message,
          data,
        })),
      }))
      await testInfo.attach('calls', {
        body: JSON.stringify({ calls, panes: tmux.panes() }, null, 2),
      })
      for (const [index, app] of launched.entries()) {
        await testInfo.attach(`app-output-${index + 1}`, { body: app.output().slice(-6_000) })
      }
      await testInfo.attach('processes', { body: processes() })
    }
    // Quit while the tmux server and the fixture Sim still answer, so a stall is the app's own.
    let quitFailure: unknown
    for (const app of launched) {
      try {
        await desktop.close(app)
      } catch (error) {
        quitFailure ??= error
      }
    }
    launched = []
    tmux.remove()
    for (const pattern of leftovers.splice(0)) {
      try {
        execFileSync('pkill', ['-9', '-f', pattern])
      } catch {
        // Nothing left.
      }
    }
    sim.reset()
    if (quitFailure) throw quitFailure
  })

  test.afterAll(async () => {
    await sim.stop()
  })

  /** Launches the app on this test's tmux server, on `userData` when relaunching. */
  async function launch(
    desktop: DesktopFixture,
    options: { userData?: string; env?: Record<string, string> } = {}
  ): Promise<ExecutorApp> {
    const app = await launchAgainst(desktop, sim, {
      userData: options.userData,
      env: { TMUX_TMPDIR: tmux.dir, ...options.env },
    })
    launched.push(app)
    return app
  }

  async function start(
    desktop: DesktopFixture,
    env: Record<string, string> = {}
  ): Promise<ExecutorApp & { deviceId: string }> {
    const app = await launch(desktop, { env })
    const deviceId = await registeredDevice(sim)
    await app.window.goto(`${sim.origin}/workspace/ws-e2e/chat/${CHAT_PLAIN}`)
    return { ...app, deviceId }
  }

  /** The app dies without a word: its shells go with it, and its tmux runs outlive it. */
  function crash(app: ExecutorApp): void {
    app.child.kill('SIGKILL')
  }

  test('Stop ends the agent command in a plain shell and leaves the user command running', async ({
    desktop,
  }) => {
    const { window, deviceId } = await start(desktop)
    leftovers.push(slept(701), slept(702))
    // The agent's terminal comes first; the user's own tab opens beside it.
    const call = await agentRunsPlain(deviceId, 701)
    await userRunsPlain(window, 702)

    sim.stopCall(call)

    await settled(sim, call, 20_000)
    await expect.poll(() => processRunning(slept(701)), { timeout: 15_000 }).toBe(false)
    expect(processRunning(slept(702))).toBe(true)
  })

  test('Stop interrupts a tagged tmux run and closes only its pane, never the user pane beside it', async ({
    desktop,
  }) => {
    requireTmux()
    const { deviceId } = await start(desktop)
    leftovers.push(slept(711), slept(712))
    const { call, pane } = await agentRunsInTmux(deviceId, tmux, 711)
    expect(pane.runId).not.toBe('')
    const users = tmux.split(pane.id, stubborn(712))

    sim.stopCall(call)

    await settled(sim, call, 20_000)
    await expect.poll(() => processRunning(slept(711)), { timeout: 15_000 }).toBe(false)
    await expect.poll(() => tmux.hasPane(pane.id), { timeout: 10_000 }).toBe(false)
    expect(tmux.hasPane(users)).toBe(true)
    expect(processRunning(slept(712))).toBe(true)
  })

  test('signing out stops every agent command and leaves the user commands running', async ({
    desktop,
  }) => {
    const { window, deviceId } = await start(desktop)
    leftovers.push(slept(721), slept(722), slept(723), slept(724))
    const plain = await agentRunsPlain(deviceId, 721)
    await claimed(plain)
    await userRunsPlain(window, 722)
    const run = REAL_TMUX ? await agentRunsInTmux(deviceId, tmux, 723) : null
    const users = run ? tmux.split(run.pane.id, stubborn(724)) : null
    if (users) await expect.poll(() => processRunning(slept(724)), { timeout: 15_000 }).toBe(true)

    // The web app signs out by navigating to its login page.
    await window.goto(`${sim.origin}/login?fromLogout=true`)

    await expect.poll(() => processRunning(slept(721)), { timeout: 30_000 }).toBe(false)
    expect(processRunning(slept(722))).toBe(true)
    if (run && users) {
      await expect.poll(() => processRunning(slept(723)), { timeout: 15_000 }).toBe(false)
      await expect.poll(() => tmux.hasPane(run.pane.id), { timeout: 10_000 }).toBe(false)
      expect(tmux.hasPane(users)).toBe(true)
      expect(processRunning(slept(724))).toBe(true)
    }
  })

  // Sign-out, the session ending and Terminal off all stop through the same stop for everything;
  // the sign-out test covers its tmux side, so these two prove only that their trigger reaches it.
  test('a session ended by another account signing in stops the agent command and leaves the user command running', async ({
    desktop,
  }) => {
    const { window, deviceId } = await start(desktop)
    leftovers.push(slept(731), slept(732))
    await agentRunsPlain(deviceId, 731)
    await userRunsPlain(window, 732)

    // Another account signing in replaces the session: the old session cookie goes away.
    await window.goto(`${sim.origin}/session-ended`)

    await expect.poll(() => processRunning(slept(731)), { timeout: 30_000 }).toBe(false)
    expect(processRunning(slept(732))).toBe(true)
  })

  test('switching Terminal off stops the agent command and leaves the user command running', async ({
    desktop,
  }) => {
    const { window, deviceId } = await start(desktop)
    leftovers.push(slept(741), slept(742))
    await agentRunsPlain(deviceId, 741)
    await userRunsPlain(window, 742)

    await bridge(window).setTerminalEnabled(false)

    await expect.poll(() => processRunning(slept(741)), { timeout: 30_000 }).toBe(false)
    expect(processRunning(slept(742))).toBe(true)
  })

  test('signing out stops a tmux run whose chat was put away', async ({ desktop }) => {
    requireTmux()
    const { window, deviceId, userData } = await start(desktop)
    leftovers.push(slept(801))
    const { pane } = await agentRunsInTmux(deviceId, tmux, 801)

    // No live terminal holds the run any more; only its record does.
    expect(await bridge(window).putAway(CHAT_TMUX)).toBe(true)
    expect(processRunning(slept(801))).toBe(true)

    await window.goto(`${sim.origin}/login?fromLogout=true`)

    await expect.poll(() => processRunning(slept(801)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    await expect.poll(() => recordedRuns(userData), { timeout: 10_000 }).toEqual([])
  })

  test('the launch after an interrupted sign-out stops the tmux run the previous app left running', async ({
    desktop,
  }) => {
    requireTmux()
    const first = await start(desktop)
    leftovers.push(slept(751))
    const { pane } = await agentRunsInTmux(first.deviceId, tmux, 751)

    // The app dies mid sign-out: its recovery marker is on disk and the tmux run outlives it.
    crash(first)
    writeFileSync(
      join(first.userData, 'account-data-teardown-required.json'),
      JSON.stringify({ version: 2, kind: 'account', origin: sim.origin })
    )
    expect(processRunning(slept(751))).toBe(true)

    await launch(desktop, { userData: first.userData })

    await expect.poll(() => processRunning(slept(751)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    await expect.poll(() => recordedRuns(first.userData), { timeout: 10_000 }).toEqual([])
  })

  test('the launch after a crash stops the tmux run its call can no longer report', async ({
    desktop,
  }) => {
    requireTmux()
    const first = await start(desktop)
    leftovers.push(slept(771), slept(772))
    const { pane } = await agentRunsInTmux(first.deviceId, tmux, 771)
    const users = tmux.split(pane.id, stubborn(772))

    // Same user, plain crash: the journal settles the call as outcome unknown, and nothing will
    // ever read what the command does.
    crash(first)
    expect(processRunning(slept(771))).toBe(true)
    await launch(desktop, { userData: first.userData })

    await expect.poll(() => processRunning(slept(771)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    expect(tmux.hasPane(users)).toBe(true)
    expect(processRunning(slept(772))).toBe(true)
    await expect.poll(() => recordedRuns(first.userData), { timeout: 10_000 }).toEqual([])
  })

  test('the launch after a crash only forgets a tmux run that had already finished', async ({
    desktop,
  }) => {
    requireTmux()
    const first = await start(desktop)
    leftovers.push(slept(6), slept(782))
    // Handed back as still running, it then finishes on its own.
    const { call, pane } = await agentRunsInTmux(first.deviceId, tmux, 6, 2)
    await settled(sim, call)
    const users = tmux.split(pane.id, stubborn(782))
    await expect.poll(() => tmux.hasPane(pane.id), { timeout: 20_000 }).toBe(false)
    expect(recordedRuns(first.userData)).toHaveLength(1)

    crash(first)
    await launch(desktop, { userData: first.userData })

    await expect.poll(() => recordedRuns(first.userData), { timeout: 30_000 }).toEqual([])
    expect(tmux.hasPane(users)).toBe(true)
    expect(processRunning(slept(782))).toBe(true)
  })

  test('a run handed back as still going survives a quit and the relaunch, and can still be read', async ({
    desktop,
  }) => {
    requireTmux()
    const first = await start(desktop)
    leftovers.push(slept(811), slept(812))
    const kept = await agentRunsInTmux(first.deviceId, tmux, 811, 2)
    const handedBack = await settled(sim, kept.call)
    expect(handedBack.data).toMatchObject({ status: 'running', pane: kept.pane.id })
    await expect.poll(() => recordedRunState(first.userData, kept.pane.runId)).toBe('delivered')
    // Still running when the app quits, so its result never reaches the model: the relaunch stops
    // it, which is also how this test knows the relaunch has decided about every recorded run.
    const uncollectable = await agentRunsInAttachedTmux(first.deviceId, tmux, 812, 120)

    // Quitting stops no tmux run.
    await desktop.close(first)
    expect(processRunning(slept(811))).toBe(true)
    expect(processRunning(slept(812))).toBe(true)

    await launch(desktop, { userData: first.userData })
    await expect.poll(() => processRunning(slept(812)), { timeout: 30_000 }).toBe(false)
    await expect
      .poll(() => recordedRuns(first.userData), { timeout: 10_000 })
      .toEqual([`${kept.pane.runId}.json`])
    expect(tmux.hasPane(uncollectable.pane.id)).toBe(false)
    expect(processRunning(slept(811))).toBe(true)
    expect(tmux.hasPane(kept.pane.id)).toBe(true)

    // Same install, same device: it is back once its doorbell is open again, and the model comes
    // back to the pane it was handed.
    const relaunched = await registeredDevice(sim)
    await agentAttachesTmux(relaunched, tmux)
    const read = sim.issue(relaunched, CHAT_TMUX, 'terminal', {
      operation: 'read',
      args: { pane: kept.pane.id, lines: 50 },
    })
    const output = await settled(sim, read)
    expect(output.status, output.message).toBe('success')
    expect(JSON.stringify(output.data)).toContain('collect-me')
  })

  test('on tmux without pane options a run goes ahead untracked, and Stop leaves it alone', async ({
    desktop,
  }) => {
    requireTmux()
    const { deviceId } = await start(desktop, { PATH: oldTmuxPath(desktop) })
    leftovers.push(slept(761))
    const { call, pane } = await agentRunsInTmux(deviceId, tmux, 761)
    expect(pane.runId).toBe('')

    sim.stopCall(call)

    // The call reports only once its stop has run, so whatever the stop did is done by now.
    const stopped = await settled(sim, call, 20_000)
    expect(stopped.status).toBe('cancelled')
    expect(processRunning(slept(761))).toBe(true)
    expect(tmux.hasPane(pane.id)).toBe(true)
  })
})
