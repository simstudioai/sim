import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitRun,
  isDescendantOf,
  parseFormatLines,
  pollRun,
  resolveAttachment,
  runPaneState,
  startRun,
  stopRun,
  type TmuxRunHandle,
} from '@/main/terminal/tmux'

/** The separator the format strings use. */
const F = '|~sim~|'

describe('parseFormatLines', () => {
  it('drops lines with the wrong field count rather than mis-assigning them', () => {
    expect(parseFormatLines(`a${F}b\nonly-one\n`, 2)).toEqual([['a', 'b']])
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
  nextWindow: number
  nextPane: number
  panes: Record<string, { window: string; options: Record<string, string> }>
  /** Every command that reached a pane: `send-keys %1 C-c`, `kill-pane %1`. */
  log: string[]
  /** Commands the fake fails, with the error tmux would print. */
  fail?: Record<string, string>
  /** Attached clients, as `list-clients` reports them. */
  clients?: Array<{ pid: string; tty: string; session: string }>
}

const FAKE_TMUX = `
const fs = require('node:fs')
const file = process.env.FAKE_TMUX_STATE
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
const save = () => fs.writeFileSync(file, JSON.stringify(state))
const target = () => args[args.indexOf('-t') + 1]
const fail = (message) => { process.stderr.write(message); process.exit(1) }
// Prints a format's output as tmux 3.4 and 3.5 do: a backslash doubled, and every other control
// character as its octal escape, so a control-character separator would arrive as text.
const escaped = (text) =>
  text
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/[\\x00-\\x1f]/g, (c) => '\\\\' + c.charCodeAt(0).toString(8).padStart(3, '0'))
if (state.fail && state.fail[args[0]]) fail(state.fail[args[0]])
switch (args[0]) {
  case 'new-window': {
    const window = '@' + state.nextWindow++
    const pane = '%' + state.nextPane++
    state.panes[pane] = { window, options: {} }
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
    const pane = state.panes[target()]
    if (!pane) fail("can't find pane")
    const name = args[args.length - 1].slice(2, -1)
    process.stdout.write((pane.options[name] ?? '') + '\\n')
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
  write({ nextWindow: 0, nextPane: 0, panes: {}, log: [] })
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

  it('never lets a run it could not tag start, and closes no pane by id to stop it', async () => {
    const tmux = fakeTmux()
    dirs.push(tmux.dir)
    tmux.write({ ...tmux.read(), fail: { 'set-option': 'invalid option: @sim-run-id' } })

    const result = await startRun('agent', 'sleep 600', null, tmux.env)

    expect(result).toMatchObject({ error: expect.stringContaining('was not run') })
    // No pane is closed by an id that a restarted server might have handed to the user.
    expect(tmux.read().log).toEqual([])
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

  it('runs a tagged command for real, and never runs one it could not tag', async () => {
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
    untagged.write({ ...untagged.read(), fail: { 'set-option': 'invalid option' } })
    const marker = join(untagged.dir, 'ran')
    await startRun('agent', `touch ${JSON.stringify(marker)}`, null, untagged.env)
    await sleep(6_000)

    expect(existsSync(marker)).toBe(false)
  }, 20_000)
})
