import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitRun,
  closeRunPane,
  isDescendantOf,
  parseFormatLines,
  pollRun,
  resolveAttachment,
  runPaneState,
  startRun,
  stopRecordedRun,
  stopRun,
  type TmuxRunHandle,
} from '@/main/terminal/tmux'

/** What real tmux 2.9a writes for `set-option -p`, captured from the binary. */
const TMUX_29_NO_PANE_OPTIONS =
  'tmux: unknown option -- p\nusage: set-option [-aFgosquw] [-t target-window] option [value]\n'
/** The same refusal from a tmux built against BSD getopt, as on macOS. */
const TMUX_29_BSD_NO_PANE_OPTIONS =
  'tmux: illegal option -- p\nusage: set-option [-aFgosquw] [-t target-window] option [value]\n'

/** The separator the format strings use. */
const F = '<~sim~>'

describe('parseFormatLines', () => {
  it('drops lines with the wrong field count rather than mis-assigning them', () => {
    expect(parseFormatLines(`a${F}b\nonly-one\n`, 2)).toEqual([['a', 'b']])
  })

  it('reads a field that ends with part of the separator as it is', () => {
    // A cwd or window name may end with any text, including all but the separator's last character.
    const partial = F.slice(0, -1)
    expect(parseFormatLines(`/tmp/x/p${partial}${F}1\n`, 2)).toEqual([[`/tmp/x/p${partial}`, '1']])
    expect(parseFormatLines(`tail${partial}${F}%3${F}zsh\n`, 3)).toEqual([
      [`tail${partial}`, '%3', 'zsh'],
    ])
  })

  it('drops a line whose field holds the whole separator rather than misread it', () => {
    expect(parseFormatLines(`a${F}b${F}c\n`, 2)).toEqual([])
  })
})

describe('isDescendantOf', () => {
  // A tmux client is usually a direct child of the shell, but an rc file that
  // execs through a wrapper can put another process in between.
  const _parents = new Map([
    [100, 1],
    [200, 100],
    [300, 200],
    [900, 1],
  ])

  it('rejects rather than looping when the chain cycles', () => {
    const cyclic = new Map([
      [10, 20],
      [20, 10],
    ])
    expect(isDescendantOf(10, 999, cyclic)).toBe(false)
  })
})

describe('run status files', () => {
  const dirs: string[] = []

  const handleIn = (dir: string): TmuxRunHandle => ({
    window: '@1',
    pane: '%1',
    runId: 'run-1',
    socket: null,
    outPath: join(dir, 'out'),
    statusPath: join(dir, 'status'),
    dispose: () => {},
  })

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tmux-run-test-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the real exit code once the status file lands', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'boom\n')
    writeFileSync(join(dir, 'status'), '7')

    expect(pollRun(handleIn(dir))).toEqual({ output: 'boom\n', exitCode: 7, done: true })
  })

  it('reports done with no code rather than NaN when the status is unreadable', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'status'), 'not-a-number')

    expect(pollRun(handleIn(dir))).toEqual({ output: '', exitCode: null, done: true })
  })

  it('hands back a still-running command when the window elapses', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'still going\n')

    // The whole point of the status file over `tmux wait-for`: a command that
    // outlives the wait leaves a pollable state rather than a blocked waiter.
    const outcome = await awaitRun(handleIn(dir), 300)

    expect(outcome).toEqual({ output: 'still going\n', exitCode: null, done: false })
  })
})

/**
 * A stand-in `tmux` binary on PATH that keeps its panes in a JSON file, so the run helpers are
 * exercised through the real `spawn` path. It knows the handful of commands runs use; a test
 * reshapes the server directly (a split, a closed window, a restart) by rewriting that file.
 */
interface FakeTmuxState {
  /** The server's socket; `-S` naming any other reaches no server. */
  socket: string
  nextWindow: number
  nextPane: number
  panes: Record<string, { window: string; options: Record<string, string>; command?: string }>
  /** Every command that reached a pane: `send-keys %1 C-c`, `kill-pane %1`. */
  log: string[]
  /** Commands the fake fails, with the error tmux would print. */
  fail?: Record<string, string>
  /** Once a key is sent, tmux stops answering: every later command fails like a dying server. */
  dieAfterKeys?: boolean
  /** On this many-th display-message, the pane is retagged as another run's (a restart race). */
  retagAtCheck?: number
  /** display-message calls so far. */
  checks?: number
  /** tmux restarts and the user's pane takes the id just before the next guarded action. */
  retagBeforeAction?: boolean
  /** Attached clients, as `list-clients` reports them. */
  clients?: Array<{ pid: string; tty: string; session: string }>
  /** Commands the fake holds until the file named here exists, like a busy tmux server. */
  hold?: Record<string, string>
  /** Commands the fake is holding right now. */
  held?: string[]
}

const FAKE_TMUX = `
const fs = require('node:fs')
const file = process.env.FAKE_TMUX_STATE
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
let args = process.argv.slice(2)
const save = () => fs.writeFileSync(file, JSON.stringify(state))
// \`-S socket\` names the server; any server but this one does not exist.
if (args[0] === '-S') {
  if (args[1] !== state.socket) {
    process.stderr.write('no server running on ' + args[1])
    process.exit(1)
  }
  args = args.slice(2)
}
const target = () => args[args.indexOf('-t') + 1]
const fail = (message) => { process.stderr.write(message); process.exit(1) }
// Prints a format's output as tmux 3.4 and 3.5 do: a backslash doubled, and every other control
// character as its octal escape, so a control-character separator would arrive as text.
const escaped = (text) =>
  text
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/[\\x00-\\x1f]/g, (c) => '\\\\' + c.charCodeAt(0).toString(8).padStart(3, '0'))
if (state.hold && state.hold[args[0]]) {
  state.held = [...(state.held ?? []), args[0]]
  save()
  while (!fs.existsSync(state.hold[args[0]])) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
  state.held = state.held.filter((command) => command !== args[0])
}
// \`if-shell -F -t pane '#{==:#{option},value}' command\`: the check and the action in one command.
if (args[0] === 'if-shell') {
  const pane = state.panes[target()]
  if (pane && state.retagBeforeAction) {
    pane.options['@sim-run-id'] = 'someone-else'
    state.retagBeforeAction = false
    save()
  }
  const check = /^#\\{==:#\\{([^}]+)\\},(.*)\\}$/.exec(args[args.length - 2])
  if (!pane || !check || (pane.options[check[1]] ?? '') !== check[2]) process.exit(0)
  args = args[args.length - 1].split(' ')
}
if (state.fail && state.fail[args[0]]) fail(state.fail[args[0]])
switch (args[0]) {
  case 'new-window': {
    const window = '@' + state.nextWindow++
    const pane = '%' + state.nextPane++
    state.panes[pane] = { window, options: {}, command: args[args.length - 1] }
    save()
    // Runs the pane's command for real, the way tmux would, when a test asks for it.
    if (process.env.FAKE_TMUX_EXEC) {
      require('node:child_process')
        .spawn('sh', ['-c', args[args.length - 1]], { detached: true, stdio: 'ignore' })
        .unref()
    }
    process.stdout.write(window + ' ' + pane + '\\n')
    break
  }
  case 'set-option': {
    const pane = state.panes[target()]
    if (!pane) fail("can't find pane")
    pane.options[args[args.length - 2]] = args[args.length - 1]
    save()
    break
  }
  case 'display-message': {
    state.checks = (state.checks ?? 0) + 1
    if (state.retagAtCheck === state.checks && state.panes[target()]) {
      state.panes[target()].options['@sim-run-id'] = 'someone-else'
    }
    save()
    // Like tmux 3.x, a pane that is gone answers with an empty line rather than an error.
    const pane = state.panes[target()]
    const name = args[args.length - 1].slice(2, -1)
    const value = !pane
      ? ''
      : name === 'pane_id'
        ? target()
        : name === 'socket_path'
          ? state.socket
        : name === 'pane_start_command'
          ? (pane.command ?? '')
          : (pane.options[name] ?? '')
    process.stdout.write(value + '\\n')
    break
  }
  case 'list-clients': {
    const format = args[args.indexOf('-F') + 1]
    for (const client of state.clients ?? []) {
      const line = format
        .replace('#{client_pid}', client.pid)
        .replace('#{client_tty}', client.tty)
        .replace('#{client_session}', client.session)
      process.stdout.write(escaped(line) + '\\n')
    }
    break
  }
  case 'send-keys':
  case 'kill-pane': {
    if (!state.panes[target()]) fail("can't find pane")
    state.log.push(args[0] + ' ' + target() + (args[0] === 'send-keys' ? ' ' + args[args.length - 1] : ''))
    if (args[0] === 'send-keys' && state.dieAfterKeys) {
      state.fail = { 'display-message': 'server exited unexpectedly', 'kill-pane': 'server exited unexpectedly' }
    }
    if (args[0] === 'kill-pane') delete state.panes[target()]
    save()
    break
  }
  default:
    fail('unsupported: ' + args[0])
}
`

function fakeTmux(options: { exec?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tmux-'))
  const stateFile = join(dir, 'state.json')
  const binary = join(dir, 'tmux')
  writeFileSync(binary, `#!${process.execPath}\n${FAKE_TMUX}`)
  chmodSync(binary, 0o755)
  const write = (state: FakeTmuxState) => writeFileSync(stateFile, JSON.stringify(state))
  write({ nextWindow: 0, nextPane: 0, panes: {}, log: [], socket: join(dir, 'server.sock') })
  const read = (): FakeTmuxState => JSON.parse(readFileSync(stateFile, 'utf8'))
  return {
    dir,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE_TMUX_STATE: stateFile,
      ...(options.exec ? { FAKE_TMUX_EXEC: '1' } : {}),
    },
    read,
    write,
    /** The user splits a run's window: a new pane of theirs beside the run's. */
    split(window: string): string {
      const state = read()
      const pane = `%${state.nextPane++}`
      state.panes[pane] = { window, options: {} }
      write(state)
      return pane
    },
    /** tmux restarts: every pane is gone and ids start over. */
    restart() {
      write({ ...read(), nextWindow: 0, nextPane: 0, panes: {} })
    },
  }
}

describe('finding the tmux session a shell runs', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the clients tmux 3.4 and 3.5 list, which escape control characters', async () => {
    const tmux = fakeTmux()
    dirs.push(tmux.dir)
    // A client of this very process: its parent stands in for the shell the client runs in.
    tmux.write({
      ...tmux.read(),
      clients: [{ pid: String(process.pid), tty: '/dev/pts/3', session: 'work' }],
    })

    expect(await resolveAttachment(process.ppid, tmux.env)).toEqual({
      session: 'work',
      clientTty: '/dev/pts/3',
    })
  })
})

describe('stopping a run another process started, from its record', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function recorded(tmux: ReturnType<typeof fakeTmux>) {
    dirs.push(tmux.dir)
    const run = await startRun('agent', 'sleep 600', null, tmux.env)
    if ('error' in run) throw new Error(run.error)
    return { run, record: { runId: run.runId ?? '', pane: run.pane, socket: run.socket ?? '' } }
  }

  it('records the server a tagged run runs on', async () => {
    const tmux = fakeTmux()
    const { run } = await recorded(tmux)

    expect(run.socket).toBe(tmux.read().socket)
  })

  it('interrupts and then closes the pane while it still carries the run tag', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)

    expect(await stopRecordedRun(record, tmux.env, 0)).toBe('gone')
    expect(tmux.read().log).toEqual([`send-keys ${record.pane} C-c`, `kill-pane ${record.pane}`])
    expect(tmux.read().panes).toEqual({})
  })

  it('never touches a pane that took the recorded id after tmux restarted', async () => {
    const tmux = fakeTmux()
    const { run, record } = await recorded(tmux)
    tmux.restart()
    const state = tmux.read()
    state.panes[run.pane] = { window: run.window, options: {}, command: 'zsh' }
    tmux.write(state)

    expect(await stopRecordedRun(record, tmux.env, 0)).toBe('gone')
    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([run.pane])
  })

  it('never asks a different tmux server about the pane', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)

    const elsewhere = { ...record, socket: join(tmux.dir, 'another.sock') }
    expect(await stopRecordedRun(elsewhere, tmux.env, 0)).toBe('gone')
    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([record.pane])
  })

  it('checks the pane is still the run once more right before closing it', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)
    // The first check (before Ctrl-C) sees the run; the next, right before closing, does not.
    tmux.write({ ...tmux.read(), checks: 0, retagAtCheck: 2 })

    expect(await stopRecordedRun(record, tmux.env, 0)).toBe('gone')
    expect(tmux.read().log).toEqual([`send-keys ${record.pane} C-c`])
    expect(Object.keys(tmux.read().panes)).toEqual([record.pane])
  })

  it('never starts a tagged run whose server it cannot name for a record', async () => {
    const tmux = fakeTmux({ exec: true })
    dirs.push(tmux.dir)
    tmux.write({ ...tmux.read(), socket: '' })
    const marker = join(tmux.dir, 'ran')

    const result = await startRun('agent', `touch ${JSON.stringify(marker)}`, null, tmux.env, {
      beforeStart: () => true,
    })

    expect(result).toMatchObject({ error: expect.stringContaining('was not run') })
    await sleep(1_500)
    expect(existsSync(marker)).toBe(false)
  })

  it('forgets the saved record of a run that then could not start', async () => {
    const tmux = fakeTmux()
    dirs.push(tmux.dir)
    const saved = new Set<string>()
    let runDir = ''

    const result = await startRun('agent', 'sleep 600', null, tmux.env, {
      beforeStart: (run) => {
        // The run's directory turns read-only, so its go file cannot be written.
        const command = tmux.read().panes[run.pane]?.command ?? ''
        const script = /"([^"]+)\/run\.sh"/.exec(command)?.[1] ?? ''
        runDir = script
        chmodSync(runDir, 0o500)
        saved.add(run.runId)
        return true
      },
      abandon: (runId) => saved.delete(runId),
    })

    if (runDir) chmodSync(runDir, 0o700)
    if (runDir) dirs.push(runDir)
    expect(result).toMatchObject({ error: expect.stringContaining('could not be started') })
    expect([...saved]).toEqual([])
  })

  it('acts on no pane that took the recorded id between the last check and the action', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)
    tmux.write({ ...tmux.read(), retagBeforeAction: true })

    await stopRecordedRun(record, tmux.env, 0)

    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([record.pane])
  })

  it('keeps the record when tmux stops answering part-way through the stop', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)
    tmux.write({ ...tmux.read(), dieAfterKeys: true })

    expect(await stopRecordedRun(record, tmux.env, 0)).toBe('unknown')
    // Its pane could not be confirmed as the run's, so it was not closed.
    expect(tmux.read().log).toEqual([`send-keys ${record.pane} C-c`])
  })

  it('saves the record before the command may start, and never starts one it could not save', async () => {
    const tmux = fakeTmux({ exec: true })
    dirs.push(tmux.dir)
    const marker = join(tmux.dir, 'ran')
    let ranBeforeRecord = true
    const run = await startRun('agent', `touch ${JSON.stringify(marker)}`, null, tmux.env, {
      beforeStart: () => {
        // Time enough for a command already released to have run.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000)
        ranBeforeRecord = existsSync(marker)
        return true
      },
    })
    if ('error' in run) throw new Error(run.error)
    expect(ranBeforeRecord).toBe(false)
    await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)

    const unsaved = fakeTmux({ exec: true })
    dirs.push(unsaved.dir)
    const unsavedMarker = join(unsaved.dir, 'ran')
    const refused = await startRun(
      'agent',
      `touch ${JSON.stringify(unsavedMarker)}`,
      null,
      unsaved.env,
      {
        beforeStart: () => false,
      }
    )
    expect(refused).toMatchObject({ error: expect.stringContaining('was not run') })
    await sleep(1_500)
    expect(existsSync(unsavedMarker)).toBe(false)
  }, 20_000)

  it('leaves the record for later while tmux cannot be asked', async () => {
    const tmux = fakeTmux()
    const { record } = await recorded(tmux)
    tmux.write({ ...tmux.read(), fail: { 'display-message': 'server exited unexpectedly' } })

    expect(await stopRecordedRun(record, tmux.env, 0)).toBe('unknown')
    expect(tmux.read().log).toEqual([])
  })
})

describe('stopping a tmux run touches only its own pane', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function started(tmux: ReturnType<typeof fakeTmux>): Promise<TmuxRunHandle> {
    dirs.push(tmux.dir)
    const handle = await startRun('agent', 'sleep 600', null, tmux.env)
    if ('error' in handle) throw new Error(handle.error)
    return handle
  }

  it('interrupts and then closes only the run pane, leaving a pane the user split beside it', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)
    const users = tmux.split(run.window)

    await stopRun(run, tmux.env, 0)

    expect(tmux.read().log).toEqual([`send-keys ${run.pane} C-c`, `kill-pane ${run.pane}`])
    expect(Object.keys(tmux.read().panes)).toEqual([users])
  })

  it('sends a live run nothing once its pane is retagged between the check and the action', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)
    tmux.write({ ...tmux.read(), retagBeforeAction: true })

    await stopRun(run, tmux.env, 0)

    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([run.pane])
  })

  it('sends nothing to a pane that reused the run pane id after tmux restarted', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)
    tmux.restart()
    // The user's own new window gets the ids the run's pane had.
    const state = tmux.read()
    state.panes[run.pane] = { window: run.window, options: {} }
    tmux.write(state)

    expect(await runPaneState(run, tmux.env)).toBe('gone')
    await stopRun(run, tmux.env, 0)

    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([run.pane])
  })

  it('treats a run pane the user closed as gone', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)
    const state = tmux.read()
    delete state.panes[run.pane]
    tmux.write(state)

    expect(await runPaneState(run, tmux.env)).toBe('gone')
    await stopRun(run, tmux.env, 0)
    expect(tmux.read().log).toEqual([])
  })

  it.each([
    ['tmux 2.9a', TMUX_29_NO_PANE_OPTIONS],
    ['BSD getopt', TMUX_29_BSD_NO_PANE_OPTIONS],
  ])(
    'starts a run untracked on a tmux without pane options (%s), and never stops it by a pane id',
    async (_build, refusal) => {
      const tmux = fakeTmux()
      dirs.push(tmux.dir)
      // tmux before 3.0 has no pane options.
      tmux.write({ ...tmux.read(), fail: { 'set-option': refusal } })

      const run = await startRun('agent', 'sleep 600', null, tmux.env)
      if ('error' in run) throw new Error(run.error)

      expect(run.runId).toBeNull()
      expect(existsSync(join(run.statusPath, '..', 'go'))).toBe(true)
      expect(await runPaneState(run, tmux.env)).toBe('unknown')
      await stopRun(run, tmux.env, 0)
      // No pane is touched by an id that a restarted server might have handed to the user.
      expect(tmux.read().log).toEqual([])
      expect(Object.keys(tmux.read().panes)).toEqual([run.pane])

      // Once its pane is gone, it can be let go.
      const state = tmux.read()
      delete state.panes[run.pane]
      tmux.write(state)
      expect(await runPaneState(run, tmux.env)).toBe('gone')
    }
  )

  it.each(['tmux did not respond', 'server exited unexpectedly'])(
    'refuses a run that a tmux able to tag panes did not tag (%s)',
    async (failure) => {
      const tmux = fakeTmux()
      dirs.push(tmux.dir)
      tmux.write({ ...tmux.read(), fail: { 'set-option': failure } })

      const result = await startRun('agent', 'sleep 600', null, tmux.env)

      // Untagged on a tmux that tags, nothing could stop it later, so it never starts.
      expect(result).toMatchObject({ error: expect.stringContaining('was not run') })
      expect(tmux.read().log).toEqual([])
    }
  )

  it("closes a finished untracked run's pane, and only once it has finished", async () => {
    const tmux = fakeTmux()
    dirs.push(tmux.dir)
    tmux.write({ ...tmux.read(), fail: { 'set-option': TMUX_29_NO_PANE_OPTIONS } })
    const run = await startRun('agent', 'make build', null, tmux.env)
    if ('error' in run) throw new Error(run.error)

    await closeRunPane(run, tmux.env)
    expect(Object.keys(tmux.read().panes)).toEqual([run.pane])

    // Its command ended; with `remain-on-exit` its dead pane would otherwise stay open.
    writeFileSync(run.statusPath, '0')
    await closeRunPane(run, tmux.env)
    expect(Object.keys(tmux.read().panes)).toEqual([])
  })

  it("never closes a pane that took a finished untracked run's id after tmux restarted", async () => {
    const tmux = fakeTmux()
    dirs.push(tmux.dir)
    tmux.write({ ...tmux.read(), fail: { 'set-option': TMUX_29_NO_PANE_OPTIONS } })
    const run = await startRun('agent', 'make build', null, tmux.env)
    if ('error' in run) throw new Error(run.error)
    writeFileSync(run.statusPath, '0')
    tmux.restart()
    // The user's own shell gets the ids the run's pane had.
    const state = tmux.read()
    state.panes[run.pane] = { window: run.window, options: {}, command: 'zsh' }
    tmux.write(state)

    await closeRunPane(run, tmux.env)

    expect(tmux.read().log).toEqual([])
    expect(Object.keys(tmux.read().panes)).toEqual([run.pane])
  })

  it('lets a tagged run start only once its pane is tagged', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)

    expect(tmux.read().panes[run.pane]?.options['@sim-run-id']).toBe(run.runId)
    expect(existsSync(join(run.statusPath, '..', 'go'))).toBe(true)
  })

  it('neither stops nor gives up on a run while tmux cannot be asked', async () => {
    const tmux = fakeTmux()
    const run = await started(tmux)
    tmux.write({ ...tmux.read(), fail: { 'display-message': 'server exited unexpectedly' } })

    expect(await runPaneState(run, tmux.env)).toBe('unknown')
    await stopRun(run, tmux.env, 0)

    expect(tmux.read().log).toEqual([])
  })

  it('runs a command for real whether or not tmux could tag its pane', async () => {
    const tagged = fakeTmux({ exec: true })
    dirs.push(tagged.dir)
    const run = await startRun('agent', 'echo ran', null, tagged.env)
    if ('error' in run) throw new Error(run.error)
    await expect
      .poll(() => pollRun(run), { timeout: 10_000 })
      .toMatchObject({
        done: true,
        exitCode: 0,
      })

    const untagged = fakeTmux({ exec: true })
    dirs.push(untagged.dir)
    untagged.write({ ...untagged.read(), fail: { 'set-option': TMUX_29_NO_PANE_OPTIONS } })
    const untracked = await startRun('agent', 'echo ran', null, untagged.env)
    if ('error' in untracked) throw new Error(untracked.error)
    await expect
      .poll(() => pollRun(untracked), { timeout: 10_000 })
      .toMatchObject({ done: true, exitCode: 0, output: 'ran\n' })
  }, 20_000)

  it('holds a command until tmux has finished tagging its pane', async () => {
    const tmux = fakeTmux({ exec: true })
    dirs.push(tmux.dir)
    const release = join(tmux.dir, 'release')
    tmux.write({ ...tmux.read(), hold: { 'set-option': release } })
    const marker = join(tmux.dir, 'ran')

    const starting = startRun('agent', `touch ${JSON.stringify(marker)}`, null, tmux.env)
    // The pane is open and the tagging call is in flight, held by tmux.
    await expect.poll(() => tmux.read().held ?? [], { timeout: 10_000 }).toEqual(['set-option'])
    // Time enough for an ungated command to have run.
    await sleep(1_000)
    expect(existsSync(marker)).toBe(false)

    writeFileSync(release, '')
    const run = await starting
    if ('error' in run) throw new Error(run.error)
    await expect.poll(() => existsSync(marker), { timeout: 10_000 }).toBe(true)
  }, 20_000)
})
