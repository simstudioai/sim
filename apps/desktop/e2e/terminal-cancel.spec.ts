import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { sleep } from '@sim/utils/helpers'
import { randomInt } from '@sim/utils/random'
import { FixtureSim, launch, processRunning, registeredDevice, settled } from './executor-sim'

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
 * show. Each launch gets its own tmux server (TMUX_TMPDIR), which the app's shells and its tmux
 * calls inherit. The tmux scenarios skip where tmux is not installed.
 */

const CHAT_PLAIN = 'chat-cancel-plain'
const CHAT_TMUX = 'chat-cancel-tmux'
const TMUX_SESSION = 'agent-e2e'
/** Commands that only a SIGKILL ends, so a shell closing around them proves nothing. */
const STUBBORN = "trap '' HUP INT TERM"

const sim = new FixtureSim()
/** The app's own log output for the current test, printed when it fails. */
const appOutput: string[] = []

/** The process tree and tmux's clients, for a failure that is about who started what. */
function diagnose(): string {
  const run = (command: string, args: string[]) => {
    try {
      return execFileSync(command, args).toString()
    } catch (error) {
      return String(error)
    }
  }
  return [
    run('ps', ['-eo', 'pid,ppid,pgid,args'])
      .split('\n')
      .filter((line) => /tmux|sleep|bash|zsh/.test(line))
      .join('\n'),
  ].join('\n')
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

/** One launch's own tmux server, and a way to read and reshape it as the user would. */
class TmuxServer {
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

  /** The pane an agent run opened, found by the run script it was started with. */
  runPane(): { id: string; runId: string } | undefined {
    return this.panes().find((pane) => pane.command.includes('run.sh'))
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

  kill(): void {
    try {
      this.run(['kill-server'])
    } catch {
      // Already gone.
    }
  }
}

/** A `tmux` ahead of the real one on PATH that refuses pane options, as tmux before 3.0 does. */
function oldTmuxPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-old-tmux-'))
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
        const terminal = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi })
          .simDesktop.terminal
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
          (
            globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
          ).simDesktop.terminal.write(id, text, scopeId),
        [terminalId, `${command}\r`, scope] as const
      )
    },
    /** The user puts a chat away: its terminals close, though tmux runs started in them go on. */
    async putAway(scope: string): Promise<boolean> {
      return window.evaluate(async (scopeId) => {
        const terminal = (globalThis as typeof globalThis & { simDesktop: SimDesktopApi })
          .simDesktop.terminal
        await terminal.activateScope(scopeId)
        return terminal.suspendScope(scopeId)
      }, scope)
    },
    async setTerminalEnabled(enabled: boolean): Promise<void> {
      await window.evaluate(
        (value) =>
          (
            globalThis as typeof globalThis & { simDesktop: SimDesktopApi }
          ).simDesktop.settings.setPreference('terminalEnabled', value),
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
  await expect.poll(() => processRunning(`${slept(seconds)}`), { timeout: 30_000 }).toBe(true)
  return call
}

/**
 * The agent's terminal attaches to tmux (the agent starts a tmux client in it), and the agent then
 * runs a command, which tmux gives its own tagged pane. Resolves with the call and that pane.
 */
/** The agent starts a tmux client in its chat's terminal, so its runs go to tmux panes. */
async function agentAttachesTmux(deviceId: string, tmux: TmuxServer): Promise<void> {
  const before = tmux.clients()
  sim.issue(deviceId, CHAT_TMUX, 'terminal', {
    operation: 'run',
    args: { command: `tmux new-session -A -s ${TMUX_SESSION}`, waitSeconds: 2 },
  })
  await expect.poll(() => tmux.clients(), { timeout: 30_000 }).toBe(before + 1)
  // The terminal's attachment is looked up again once its short cache lapses.
  await sleep(3_500)
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
  // It ignores Ctrl-C, so stopping it takes closing its pane, the step that must spare the user's.
  const call = sim.issue(deviceId, CHAT_TMUX, 'terminal', {
    operation: 'run',
    args: {
      command: `bash -c "trap '' INT; echo collect-me; ${slept(seconds)}"`,
      waitSeconds,
    },
  })
  await expect.poll(() => processRunning(`${slept(seconds)}`), { timeout: 30_000 }).toBe(true)
  await expect.poll(() => tmux.runPane(), { timeout: 10_000 }).toBeTruthy()
  return { call, pane: tmux.runPane() as { id: string; runId: string } }
}

async function claimed(call: string): Promise<void> {
  await expect.poll(() => sim.requireCall(call).claims, { timeout: 30_000 }).toBe(1)
}

test.describe('terminal cancel', () => {
  let app: ElectronApplication | null = null
  let tmux: TmuxServer
  const leftovers: string[] = []

  test.beforeAll(async () => {
    await sim.start()
  })

  test.beforeEach(() => {
    tmux = new TmuxServer()
  })

  test.afterEach(async () => {
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
      console.log(JSON.stringify({ calls, panes: tmux.panes() }, null, 2))
      console.log(appOutput.join('').slice(-6_000))
      console.log(diagnose())
      console.log(
        (() => {
          try {
            return tmux.run(['list-clients', '-F', '#{client_pid} #{client_tty} #{client_session}'])
          } catch (error) {
            return String(error)
          }
        })()
      )
    }
    appOutput.length = 0
    // Quitting with a command still running in a tab asks first (natively, on macOS), and nobody
    // is there to answer, so a close that does not finish promptly ends the app instead.
    const closing = app
    const closed = await Promise.race([
      closing?.close().then(
        () => true,
        () => true
      ) ?? Promise.resolve(true),
      sleep(5_000).then(() => false),
    ])
    if (!closed) closing?.process().kill('SIGKILL')
    app = null
    tmux.kill()
    for (const pattern of leftovers.splice(0)) {
      try {
        execFileSync('pkill', ['-9', '-f', pattern])
      } catch {
        // Nothing left.
      }
    }
    sim.reset()
  })

  test.afterAll(async () => {
    await sim.stop()
  })

  async function start(
    name: string,
    env: Record<string, string> = {}
  ): Promise<{ window: Page; deviceId: string; userData: string }> {
    const userData = mkdtempSync(join(tmpdir(), `sim-cancel-${name}-`))
    const launched = await launch(sim, userData, { TMUX_TMPDIR: tmux.dir, ...env })
    app = launched.app
    launched.app.process().stdout?.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()))
    launched.app.process().stderr?.on('data', (chunk: Buffer) => appOutput.push(chunk.toString()))
    const deviceId = await registeredDevice(sim)
    await launched.window.goto(`${sim.origin}/workspace/ws-e2e/chat/${CHAT_PLAIN}`)
    return { window: launched.window, deviceId, userData }
  }

  test('Stop ends the agent command in a plain shell and leaves the user command running', async () => {
    const { window, deviceId } = await start('stop-plain')
    leftovers.push(slept(701), slept(702))
    // The agent's terminal comes first; the user's own tab opens beside it.
    const call = await agentRunsPlain(deviceId, 701)
    await bridge(window).userRuns(CHAT_PLAIN, stubborn(702))
    await expect.poll(() => processRunning(slept(702)), { timeout: 30_000 }).toBe(true)

    sim.stopCall(call)

    await settled(sim, call, 20_000)
    await expect.poll(() => processRunning(slept(701)), { timeout: 15_000 }).toBe(false)
    expect(processRunning(slept(702))).toBe(true)
  })

  test('Stop interrupts a tagged tmux run and closes only its pane, never the user pane beside it', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId } = await start('stop-tmux')
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

  test('signing out stops every agent command and leaves the user commands running', async () => {
    const { window, deviceId } = await start('sign-out')
    leftovers.push(slept(721), slept(722), slept(723), slept(724))
    const plain = await agentRunsPlain(deviceId, 721)
    await claimed(plain)
    await bridge(window).userRuns(CHAT_PLAIN, stubborn(722))
    await expect.poll(() => processRunning(slept(722)), { timeout: 30_000 }).toBe(true)
    const run = REAL_TMUX ? await agentRunsInTmux(deviceId, tmux, 723) : null
    const users = run ? tmux.split(run.pane.id, stubborn(724)) : null

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

  test('a session ended by another account signing in stops every agent command', async () => {
    const { window, deviceId } = await start('account')
    leftovers.push(slept(731), slept(733))
    await agentRunsPlain(deviceId, 731)
    const run = REAL_TMUX ? await agentRunsInTmux(deviceId, tmux, 733) : null

    // Another account signing in replaces the session: the old session cookie goes away.
    await window.goto(`${sim.origin}/session-ended`)

    await expect.poll(() => processRunning(slept(731)), { timeout: 30_000 }).toBe(false)
    if (run) {
      await expect.poll(() => processRunning(slept(733)), { timeout: 15_000 }).toBe(false)
      await expect.poll(() => tmux.hasPane(run.pane.id), { timeout: 10_000 }).toBe(false)
    }
  })

  test('switching Terminal off stops every agent command and leaves the user commands running', async () => {
    const { window, deviceId } = await start('terminal-off')
    leftovers.push(slept(741), slept(743), slept(744))
    await agentRunsPlain(deviceId, 741)
    const run = REAL_TMUX ? await agentRunsInTmux(deviceId, tmux, 743) : null
    const users = run ? tmux.split(run.pane.id, stubborn(744)) : null

    await bridge(window).setTerminalEnabled(false)

    await expect.poll(() => processRunning(slept(741)), { timeout: 30_000 }).toBe(false)
    if (run && users) {
      await expect.poll(() => processRunning(slept(743)), { timeout: 15_000 }).toBe(false)
      await expect.poll(() => tmux.hasPane(run.pane.id), { timeout: 10_000 }).toBe(false)
      expect(tmux.hasPane(users)).toBe(true)
      expect(processRunning(slept(744))).toBe(true)
    }
  })

  test('signing out stops a tmux run whose chat was put away', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { window, deviceId, userData } = await start('put-away')
    leftovers.push(slept(801))
    const { pane } = await agentRunsInTmux(deviceId, tmux, 801)

    // No live terminal holds the run any more; only its record does.
    expect(await bridge(window).putAway(CHAT_TMUX)).toBe(true)
    await sleep(1_000)
    expect(processRunning(slept(801))).toBe(true)

    await window.goto(`${sim.origin}/login?fromLogout=true`)

    await expect.poll(() => processRunning(slept(801)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    await expect.poll(() => recordedRuns(userData), { timeout: 10_000 }).toEqual([])
  })

  /** The app dies without a word: its shells go with it, and its tmux runs outlive it. */
  function crash(): void {
    app?.process().kill('SIGKILL')
    app = null
  }

  /** The runs this app has recorded for a later process to find. */
  function recordedRuns(userData: string): string[] {
    try {
      return readdirSync(join(userData, 'terminal-runs'))
    } catch {
      return []
    }
  }

  test('the launch after an interrupted sign-out stops the tmux run the previous app left running', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId, userData } = await start('recovery')
    leftovers.push(slept(751))
    const { pane } = await agentRunsInTmux(deviceId, tmux, 751)

    // The app dies mid sign-out: its recovery marker is on disk and the tmux run outlives it.
    crash()
    writeFileSync(
      join(userData, 'account-data-teardown-required.json'),
      JSON.stringify({ version: 2, kind: 'account', origin: sim.origin })
    )
    expect(processRunning(slept(751))).toBe(true)

    app = (await launch(sim, userData, { TMUX_TMPDIR: tmux.dir })).app

    await expect.poll(() => processRunning(slept(751)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    await expect.poll(() => recordedRuns(userData), { timeout: 10_000 }).toEqual([])
  })

  test('the launch after a crash stops the tmux run its call can no longer report', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId, userData } = await start('crash-live')
    leftovers.push(slept(771), slept(772))
    const { pane } = await agentRunsInTmux(deviceId, tmux, 771)
    const users = tmux.split(pane.id, stubborn(772))

    // Same user, plain crash: the journal settles the call as outcome unknown, and nothing will
    // ever read what the command does.
    crash()
    expect(processRunning(slept(771))).toBe(true)
    app = (await launch(sim, userData, { TMUX_TMPDIR: tmux.dir })).app

    await expect.poll(() => processRunning(slept(771)), { timeout: 30_000 }).toBe(false)
    expect(tmux.hasPane(pane.id)).toBe(false)
    expect(tmux.hasPane(users)).toBe(true)
    expect(processRunning(slept(772))).toBe(true)
    await expect.poll(() => recordedRuns(userData), { timeout: 10_000 }).toEqual([])
  })

  test('the launch after a crash only forgets a tmux run that had already finished', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId, userData } = await start('crash-finished')
    leftovers.push(slept(6), slept(782))
    // Handed back as still running, it then finishes on its own.
    const { call, pane } = await agentRunsInTmux(deviceId, tmux, 6, 2)
    await settled(sim, call)
    const users = tmux.split(pane.id, stubborn(782))
    await expect.poll(() => tmux.hasPane(pane.id), { timeout: 20_000 }).toBe(false)
    expect(recordedRuns(userData)).toHaveLength(1)

    crash()
    app = (await launch(sim, userData, { TMUX_TMPDIR: tmux.dir })).app

    await expect.poll(() => recordedRuns(userData), { timeout: 30_000 }).toEqual([])
    expect(tmux.hasPane(users)).toBe(true)
    expect(processRunning(slept(782))).toBe(true)
  })

  test('a run handed back as still going survives a quit and the relaunch, and can still be read', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId, userData } = await start('collectable')
    leftovers.push(slept(811))
    const { call, pane } = await agentRunsInTmux(deviceId, tmux, 811, 2)
    const handedBack = await settled(sim, call)
    expect(handedBack.data).toMatchObject({ status: 'running', pane: pane.id })

    // Quitting stops no tmux run; the relaunch leaves one the model may come back to.
    const quitting = app
    app = null
    const quit = await Promise.race([
      quitting?.close().then(() => true) ?? Promise.resolve(true),
      sleep(10_000).then(() => false),
    ])
    if (!quit) quitting?.process().kill('SIGKILL')
    expect(processRunning(slept(811))).toBe(true)
    app = (await launch(sim, userData, { TMUX_TMPDIR: tmux.dir })).app
    // Same install, same device: it is back once its doorbell is open again.
    const relaunched = await registeredDevice(sim)
    await sleep(5_000)
    expect(processRunning(slept(811))).toBe(true)
    expect(tmux.hasPane(pane.id)).toBe(true)
    expect(recordedRuns(userData)).toHaveLength(1)

    // The model comes back to the pane it was handed.
    await agentAttachesTmux(relaunched, tmux)
    const read = sim.issue(relaunched, CHAT_TMUX, 'terminal', {
      operation: 'read',
      args: { pane: pane.id, lines: 50 },
    })
    const output = await settled(sim, read)
    expect(output.status, output.message).toBe('success')
    expect(JSON.stringify(output.data)).toContain('collect-me')
  })

  test("never touches a pane that took a recorded run's id after tmux restarted", async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { deviceId, userData } = await start('stale-record')
    leftovers.push(slept(791), slept(792))
    const { pane } = await agentRunsInTmux(deviceId, tmux, 791)
    crash()

    // tmux restarts, ending the run with it, and the user's own pane gets the run's old id.
    tmux.kill()
    // The old server takes a moment to let go of its socket.
    await expect
      .poll(
        () => {
          try {
            tmux.run(['-f', '/dev/null', 'new-session', '-d', '-s', 'users', stubborn(792)])
            return true
          } catch {
            return false
          }
        },
        { timeout: 10_000 }
      )
      .toBe(true)
    for (let panes = 0; panes < 10 && !tmux.hasPane(pane.id); panes += 1) {
      tmux.split('users', stubborn(792))
    }
    expect(processRunning(slept(791))).toBe(false)

    app = (await launch(sim, userData, { TMUX_TMPDIR: tmux.dir })).app

    await expect.poll(() => recordedRuns(userData), { timeout: 30_000 }).toEqual([])
    expect(tmux.hasPane(pane.id)).toBe(true)
    expect(processRunning(slept(792))).toBe(true)
  })

  test('on tmux without pane options a run goes ahead untracked, and Stop and sign-out leave it alone', async () => {
    test.skip(!REAL_TMUX, 'tmux is not installed on this machine')
    const { window, deviceId } = await start('untracked', { PATH: oldTmuxPath() })
    leftovers.push(slept(761))
    const { call, pane } = await agentRunsInTmux(deviceId, tmux, 761)
    expect(pane.runId).toBe('')

    sim.stopCall(call)
    await settled(sim, call, 20_000)
    await sleep(6_000)
    expect(processRunning(slept(761))).toBe(true)
    expect(tmux.hasPane(pane.id)).toBe(true)

    await window.goto(`${sim.origin}/login?fromLogout=true`)
    await sleep(8_000)
    expect(processRunning(slept(761))).toBe(true)
    expect(tmux.hasPane(pane.id)).toBe(true)
  })
})
