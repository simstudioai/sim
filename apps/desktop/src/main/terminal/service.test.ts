import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from '@sim/utils/helpers'
import { describe, expect, it, vi } from 'vitest'
import { TerminalService } from '@/main/terminal'
import { createRunLedger } from '@/main/terminal/run-ledger'

/**
 * A tmux attachment the service sees only when a test turns it on. Runs get real status files;
 * stopping a run ends its command the way Ctrl-C in its pane would. Which panes tmux still holds
 * as the run's, and the identity checks behind that, are covered against a fake tmux binary in
 * `tmux.test.ts`; here the service's bookkeeping is what is under test.
 */
const tmuxFake = vi.hoisted(() => ({
  on: false,
  /** Panes a run was stopped in, in order. */
  stopped: [] as string[],
  /** Panes no longer the run's (closed by the user, or reused after a tmux restart). */
  gone: new Set<string>(),
  /** Runs start untracked, as on a tmux too old to tag their panes. */
  untracked: false,
  /** Run panes tmux still shows, kept open after their command ends (`remain-on-exit`). */
  open: new Set<string>(),
  /** tmux stops answering: no pane can be confirmed, so none is closed. */
  unanswered: false,
  statusPaths: new Map<string, string>(),
}))

vi.mock('@/main/terminal/tmux', async () => {
  const actual =
    await vi.importActual<typeof import('@/main/terminal/tmux')>('@/main/terminal/tmux')
  let nextPane = 1
  return {
    ...actual,
    isTmuxUnavailable: () => (tmuxFake.on ? false : actual.isTmuxUnavailable()),
    resolveAttachment: async (pid: number, env: NodeJS.ProcessEnv) =>
      tmuxFake.on
        ? { session: 'agent', clientTty: '/dev/ttys001' }
        : actual.resolveAttachment(pid, env),
    startRun: async (...args: Parameters<typeof actual.startRun>) => {
      if (!tmuxFake.on) return actual.startRun(...args)
      const options = args[4]
      const pane = `%${nextPane++}`
      const runId = tmuxFake.untracked ? null : `run-${pane.slice(1)}`
      const socket = tmuxFake.untracked ? null : '/tmp/tmux-fake/default'
      // Like the real one, a tagged run starts only once its record is saved.
      if (
        runId &&
        socket &&
        options?.beforeStart &&
        !options.beforeStart({ runId, pane, socket })
      ) {
        return { error: 'The command could not be recorded for a later stop, so it was not run.' }
      }
      const dir = mkdtempSync(join(tmpdir(), 'sim-tmux-fake-'))
      const statusPath = join(dir, 'status')
      writeFileSync(join(dir, 'out'), 'partial output')
      tmuxFake.statusPaths.set(pane, statusPath)
      tmuxFake.open.add(pane)
      return {
        window: `@${pane.slice(1)}`,
        pane,
        runId,
        socket,
        outPath: join(dir, 'out'),
        statusPath,
        dispose: () => rmSync(dir, { recursive: true, force: true }),
      }
    },
    runPaneState: async (...args: Parameters<typeof actual.runPaneState>) => {
      if (!tmuxFake.on) return actual.runPaneState(...args)
      if (tmuxFake.unanswered) return 'unknown'
      if (tmuxFake.gone.has(args[0].pane)) return 'gone'
      return args[0].runId === null ? 'unknown' : 'ours'
    },
    stopRun: async (...args: Parameters<typeof actual.stopRun>) => {
      if (!tmuxFake.on) return actual.stopRun(...args)
      const [handle] = args
      if (tmuxFake.gone.has(handle.pane) || handle.runId === null) return
      tmuxFake.stopped.push(handle.pane)
      writeFileSync(handle.statusPath, '130')
    },
    closeRunPane: async (...args: Parameters<typeof actual.closeRunPane>) => {
      if (!tmuxFake.on) return actual.closeRunPane(...args)
      if (tmuxFake.unanswered) return
      tmuxFake.open.delete(args[0].pane)
      tmuxFake.gone.add(args[0].pane)
    },
  }
})

/** Stub sessions by terminal id, populated by the mock below. */
const { stubSessions } = vi.hoisted(() => ({
  stubSessions: new Map<
    string,
    {
      setBusy(busy: boolean): void
      exit(): void
      clearScrollback(): void
      /** Whether Ctrl-C ends the running command, as it does for most programs. */
      setInterruptible(interruptible: boolean): void
      /** Ends the running command the way its process exiting would. */
      finishRun(exitCode: number): void
      kill: ReturnType<typeof vi.fn>
      readonly runningToolCallId: string | null
    }
  >(),
}))

/**
 * These cover the rules the service enforces around closing, without spawning
 * real shells: node-pty is stubbed so a "session" is just an object the
 * service tracks. The behaviour under test is which terminals exist afterwards
 * and which one is active, not anything a pty does.
 */
vi.mock('@/main/terminal/session', async () => {
  const actual =
    await vi.importActual<typeof import('@/main/terminal/session')>('@/main/terminal/session')
  let nextPid = 1000
  return {
    ...actual,
    TerminalSession: {
      create: ({
        terminalId,
        cwd,
        cols,
        rows,
        callbacks,
      }: Record<string, never> & {
        terminalId: string
        callbacks: { onExit(terminalId: string): void }
      }) => {
        const state = {
          cwd,
          disposed: false,
          busy: false,
          interruptible: true,
          toolCallId: null as string | null,
          resolveRun: null as ((result: Record<string, unknown>) => void) | null,
        }
        const finishRun = (exitCode: number) => {
          const resolve = state.resolveRun
          state.busy = false
          state.toolCallId = null
          state.resolveRun = null
          resolve?.({ status: 'completed', exitCode, terminalId })
        }
        const stub = {
          setBusy: (busy: boolean) => {
            state.busy = busy
          },
          setInterruptible: (interruptible: boolean) => {
            state.interruptible = interruptible
          },
          finishRun,
          runCommand: (_command: string, toolCallId: string) =>
            new Promise((resolve) => {
              state.busy = true
              state.toolCallId = toolCallId
              state.resolveRun = resolve
            }),
          get runningToolCallId() {
            return state.toolCallId
          },
          get agentCommandToolCallId() {
            return state.toolCallId
          },
          kill: vi.fn((signal: string) => {
            if (signal === 'SIGINT' && state.interruptible) finishRun(130)
          }),
          waitForShellIntegration: async () => {},
          /** Stands in for the user running `exit` or pressing Ctrl-D. */
          exit: () => {
            state.disposed = true
            callbacks.onExit(terminalId)
          },
          terminalId,
          cols,
          rows,
          pid: nextPid++,
          env: {},
          get alive() {
            return !state.disposed
          },
          get currentCwd() {
            return state.cwd
          },
          shell: 'zsh',
          get foreground() {
            return state.busy ? 'sleep 1' : null
          },
          get isBusy() {
            return state.busy
          },
          hasShellIntegration: true,
          /** Real sessions poll the pty here; a stub's cwd only ever changes on open. */
          refreshCwd: async () => {},
          dispose: () => {
            state.disposed = true
          },
          tabState: (active: boolean) => ({
            terminalId,
            title: 'zsh',
            cwd: state.cwd,
            running: null,
            interactive: false,
            active,
          }),
          takeReplaySnapshot: () => '',
          clearScrollback: vi.fn(),
          readScrollback: () => ({
            output: 'Do you want to proceed? [y/N]',
            cwd: state.cwd,
            terminalId,
            truncated: false,
            running: state.busy ? 'sleep 1' : null,
          }),
        }
        stubSessions.set(terminalId, stub)
        return stub
      },
    },
  }
})

function service(): TerminalService {
  return new TerminalService({ loadCwd: () => '/tmp' })
}

describe('closing terminals', () => {
  it('closes one of several and activates a neighbour', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const second = terminal.openTerminal()
    const secondId = second.activeTerminalId

    const after = terminal.closeTerminal(secondId as string)

    expect(after.tabs).toHaveLength(1)
    expect(after.activeTerminalId).not.toBe(secondId)
  })
})

type OwnerWindow = Parameters<TerminalService['handleFocusedShortcut']>[1]

function runShortcut(
  terminal: TerminalService,
  shortcut: Parameters<TerminalService['handleFocusedShortcut']>[0],
  ownerWindow: OwnerWindow,
  emit = vi.fn()
): boolean {
  return terminal.handleFocusedShortcut(shortcut, ownerWindow, emit)
}

/**
 * A stand-in for one app window and the renderer inside it.
 *
 * Focus claims are bound to the renderer that made them, and every accelerator
 * arrives from a window, so the pair travels together — `contents` makes the
 * claim, `window` is what a Cmd-W from that window looks like. Two stubs model
 * two windows, which is what the cross-window cases need.
 */
function rendererStub() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const contents = {
    isDestroyed: () => false,
    once: (event: string, fn: (...args: unknown[]) => void) => listeners.set(event, fn),
    on: (event: string, fn: (...args: unknown[]) => void) => listeners.set(event, fn),
    removeListener: (event: string) => listeners.delete(event),
  } as unknown as Parameters<TerminalService['setPanelFocused']>[1]
  return {
    contents,
    /** The window hosting this renderer, for the accelerator-side calls. */
    window: { webContents: contents } as unknown as OwnerWindow,
    /** Fire a main-process lifecycle event the renderer would not survive. */
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args),
  }
}

describe('focus-gated shortcuts', () => {
  it('ignores close and reopen while the panel is not focused', () => {
    // Cmd-W and Cmd-Shift-T are global menu accelerators, so they arrive even
    // when the user is working somewhere else entirely.
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(false)
    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(false)
  })

  it('keeps agent work in the visible terminal after the user focuses it', async () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const visibleId = started.activeTerminalId as string
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    const response = await terminal.executeTool('call-cwd', 'cwd', { terminalId: visibleId })
    const result = response.result as { terminalId: string } | undefined

    expect(response.ok).toBe(true)
    expect(result?.terminalId).toBe(visibleId)
    expect(terminal.getTabs().tabs).toHaveLength(1)
    expect(terminal.getTabs().activeTerminalId).toBe(visibleId)
    expect(terminal.getTabs().agentActiveTerminalId).toBe(visibleId)
  })

  it('keeps a running terminal open when close confirmation is declined', () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const activeId = started.activeTerminalId as string
    stubSessions.get(activeId)?.setBusy(true)
    const renderer = rendererStub()
    const confirmClose = vi.fn(() => false)
    terminal.setPanelFocused(true, renderer.contents)

    expect(
      terminal.handleFocusedShortcut('close-tab', renderer.window, vi.fn(), confirmClose)
    ).toBe(true)

    expect(confirmClose).toHaveBeenCalledWith('sleep 1')
    expect(terminal.getTabs().activeTerminalId).toBe(activeId)
  })

  it('does not close a replacement terminal after the original exits during confirmation', async () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const id = started.activeTerminalId as string
    stubSessions.get(id)?.setBusy(true)
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)
    let resolvePermission: (value: boolean) => void = () => {}
    const permission = {
      promise: new Promise<boolean>((resolve) => {
        resolvePermission = resolve
      }),
      resolve: (value: boolean) => resolvePermission(value),
    }
    terminal.handleFocusedShortcut('close-tab', renderer.window, vi.fn(), () => permission.promise)
    stubSessions.get(id)?.exit()
    const replacement = terminal.openTerminal().activeTerminalId
    permission.resolve(true)
    await permission.promise
    expect(terminal.getTabs().activeTerminalId).toBe(replacement)
  })

  it('answers only the window whose renderer holds the claim', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    expect(runShortcut(terminal, 'close-tab', rendererStub().window)).toBe(false)
    // And null — no window at all cannot be the window a claim answers for.
    expect(runShortcut(terminal, 'close-tab', null)).toBe(false)

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(true)
  })

  it('fails cleanly instead of opening a seventeenth terminal', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    while (terminal.getTabs().tabs.length < 16) terminal.openTerminal()

    expect(() => terminal.openTerminal()).toThrow(
      expect.objectContaining({
        code: 'RESOURCE_LIMIT',
        message: 'A task can have at most 16 live terminals.',
      })
    )
    expect(terminal.getTabs().tabs).toHaveLength(16)
  })

  it('ignores a blur reported by a renderer that does not hold the claim', () => {
    // Every renderer reports its own blur, so a second window switching away
    // from its terminal sends `false` from a WebContents that never claimed.
    // Honouring that erased the live claim of the window the user was typing
    // in, and their next Cmd-W closed that window with its shells running.
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const holder = rendererStub()
    const other = rendererStub()
    terminal.setPanelFocused(true, holder.contents)

    terminal.setPanelFocused(false, other.contents)

    expect(runShortcut(terminal, 'close-tab', holder.window)).toBe(true)
  })
})

describe('handing the terminal to the user', () => {
  it('resolves when the blocked command finishes, without the user pressing anything', async () => {
    // Answering the prompt in the panel is the common case: the command
    // completes and the agent should just carry on.
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const id = started.activeTerminalId as string
    stubSessions.get(id)?.setBusy(true)

    const handoff = terminal.executeTool('call-1', 'handoff', {
      terminalId: id,
      reason: 'Confirm the install',
    })
    setTimeout(() => stubSessions.get(id)?.setBusy(false), 20)
    const response = await handoff

    expect(response.ok).toBe(true)
    const result = response.result as {
      handedBack: boolean
      running: string | null
      reason: string
    }
    expect(result.handedBack).toBe(false)
    expect(result.running).toBeNull()
    expect(result.reason).toBe('Confirm the install')
  })

  it('fails the handoff if the terminal is closed while it waits', async () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const id = started.activeTerminalId as string
    stubSessions.get(id)?.setBusy(true)

    const handoff = terminal.executeTool('call-1', 'handoff', { terminalId: id, reason: 'Sign in' })
    setTimeout(() => terminal.dispose(), 20)
    const response = await handoff

    expect(response.ok).toBe(false)
    expect(response.code).toBe('SESSION_CLOSED')
  })
})

describe('closing', () => {
  it('does not let the agent close the visible terminal the user selected', async () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const second = terminal.openTerminal()

    const response = await terminal.executeTool('call-1', 'close', {
      terminalId: second.activeTerminalId as string,
    })

    expect(response.ok).toBe(false)
    expect(response.code).toBe('INVALID_REQUEST')
    expect(terminal.getTabs().tabs).toHaveLength(2)
  })
})

describe('a shell that ends by itself', () => {
  it('drops the only terminal instead of leaving a dead tab', () => {
    const terminal = service()
    const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
    const original = activeTerminalId as string

    stubSessions.get(original)?.exit()

    // An exited shell can no longer do anything, so its tab goes away rather
    // than sitting there unusable; the strip is free to offer a new one.
    const after = terminal.getTabs()
    expect(after.tabs).toHaveLength(0)
    expect(after.activeTerminalId).toBeNull()
  })
})

describe('stopping a tool call', () => {
  const COMMAND_GROUP = 4242

  function cancellableService() {
    /** The tty's foreground group as the OS would report it at each read. */
    let foreground: number | null = COMMAND_GROUP
    const processGroups = {
      foreground: vi.fn(async (_shellPid: number) => foreground),
      signal: vi.fn((_pgid: number, _signal: NodeJS.Signals) => {}),
    }
    const terminal = new TerminalService({ loadCwd: () => '/tmp', processGroups })
    const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
    const session = stubSessions.get(activeTerminalId as string)
    if (!session) throw new Error('No stub session')
    return {
      terminal,
      session,
      processGroups,
      setForeground: (pgid: number | null) => {
        foreground = pgid
      },
    }
  }

  /** Starts a run and waits until its command holds the terminal's foreground. */
  async function startRun(
    terminal: TerminalService,
    session: { runningToolCallId: string | null },
    toolCallId: string
  ) {
    const running = terminal.executeTool(toolCallId, 'run', { command: 'sleep 60' })
    await vi.waitFor(() => expect(session.runningToolCallId).toBe(toolCallId))
    return { running }
  }

  it('interrupts the command its run started, and the run reports how it ended', async () => {
    const { terminal, session, processGroups } = cancellableService()
    const { running } = await startRun(terminal, session, 'call-run')

    await expect(terminal.cancelTool('call-run')).resolves.toBe(true)

    expect(session.kill).toHaveBeenCalledWith('SIGINT')
    await expect(running).resolves.toMatchObject({ ok: true, result: { exitCode: 130 } })
    expect(processGroups.signal).not.toHaveBeenCalled()
  })

  it("terminates the command's own process group when it ignores Ctrl-C", async () => {
    const { terminal, session, processGroups } = cancellableService()
    session.setInterruptible(false)
    processGroups.signal.mockImplementation(() => session.finishRun(143))
    const { running } = await startRun(terminal, session, 'call-stubborn')

    await terminal.cancelTool('call-stubborn')

    expect(processGroups.signal).toHaveBeenCalledWith(COMMAND_GROUP, 'SIGTERM')
    await expect(running).resolves.toMatchObject({ ok: true, result: { exitCode: 143 } })
  })

  it('never signals a different command that took the foreground meanwhile', async () => {
    const { terminal, session, processGroups, setForeground } = cancellableService()
    session.setInterruptible(false)
    const { running } = await startRun(terminal, session, 'call-replaced')
    session.kill.mockImplementation(() => setForeground(9999))

    await terminal.cancelTool('call-replaced')

    expect(processGroups.signal).not.toHaveBeenCalled()
    session.finishRun(0)
    await running
  })

  it('runs nothing when the Stop arrives before the command starts', async () => {
    const { terminal, session } = cancellableService()
    const running = terminal.executeTool('call-early', 'run', { command: 'rm -rf build' })
    await terminal.cancelTool('call-early')

    await expect(running).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(session.runningToolCallId).toBeNull()
  })

  it('sends no signal or keys for a kill or input stopped before it starts', async () => {
    const { terminal, session } = cancellableService()
    session.setBusy(true)
    const killing = terminal.executeTool('call-kill', 'kill', { signal: 'SIGTERM' })
    const typing = terminal.executeTool('call-input', 'input', { text: 'yes\n' })
    await Promise.all([terminal.cancelTool('call-kill'), terminal.cancelTool('call-input')])

    await expect(killing).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
    await expect(typing).resolves.toMatchObject({ ok: false, code: 'CANCELLED' })
    expect(session.kill).not.toHaveBeenCalled()
  })

  it("stops the agent's running command at sign-out", async () => {
    const { terminal, session } = cancellableService()
    const { running } = await startRun(terminal, session, 'call-left-running')

    await terminal.stopAgentCommands()

    expect(session.kill).toHaveBeenCalledWith('SIGINT')
    await expect(running).resolves.toMatchObject({ ok: true, result: { exitCode: 130 } })
  })

  it('leaves a command the user started alone at sign-out', async () => {
    const { terminal, session, processGroups } = cancellableService()
    session.setBusy(true)

    await terminal.stopAgentCommands()

    expect(session.kill).not.toHaveBeenCalled()
    expect(processGroups.signal).not.toHaveBeenCalled()
  })

  it('leaves the terminal alone for a call it is not running', async () => {
    const { terminal, session, processGroups } = cancellableService()
    const { running } = await startRun(terminal, session, 'call-other')

    await expect(terminal.cancelTool('call-unknown')).resolves.toBe(false)
    expect(session.kill).not.toHaveBeenCalled()
    expect(processGroups.signal).not.toHaveBeenCalled()
    session.finishRun(0)
    await running
  })
})

describe('agent commands in tmux', () => {
  it('stops a tmux run at sign-out while its call still waits on it', async () => {
    tmuxFake.on = true
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      terminal.start({ cols: 80, rows: 24 })
      const running = terminal.executeTool('call-tmux', 'run', {
        command: 'sleep 600',
        waitSeconds: 60,
      })
      await vi.waitFor(() => expect(tmuxFake.statusPaths.size).toBe(1))

      await terminal.stopAgentCommands()

      expect(tmuxFake.stopped).toEqual(['%1'])
      await expect(running).resolves.toMatchObject({
        ok: true,
        result: { status: 'completed', exitCode: 130 },
      })
    } finally {
      tmuxFake.on = false
    }
  })

  it('reports an untracked run it could not stop as still running, and keeps tracking it', async () => {
    tmuxFake.on = true
    tmuxFake.untracked = true
    tmuxFake.statusPaths.clear()
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      terminal.start({ cols: 80, rows: 24 })
      const running = terminal.executeTool('call-untracked', 'run', {
        command: 'sleep 600',
        waitSeconds: 60,
      })
      await vi.waitFor(() => expect(tmuxFake.statusPaths.size).toBe(1))
      const [, statusPath = ''] = [...tmuxFake.statusPaths][0] ?? []

      await terminal.cancelTool('call-untracked')

      await expect(running).resolves.toMatchObject({ ok: true, result: { status: 'running' } })
      expect(existsSync(join(statusPath, '..'))).toBe(true)

      // Once it does finish, the next run's bookkeeping reaps it.
      writeFileSync(statusPath, '0')
      await terminal.executeTool('call-next', 'run', { command: 'ls', waitSeconds: 1 })
      expect(existsSync(join(statusPath, '..'))).toBe(false)
    } finally {
      tmuxFake.on = false
      tmuxFake.untracked = false
    }
  })

  it('keeps a record of a tagged run exactly as long as the run goes on', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    const scratch = mkdtempSync(join(tmpdir(), 'sim-ledger-'))
    const ledgerDir = join(scratch, 'terminal-runs')
    const ledger = createRunLedger(ledgerDir)
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp', runLedger: ledger })
      terminal.start({ cols: 80, rows: 24 })
      await terminal.executeTool('call-long', 'run', { command: 'make build', waitSeconds: 1 })
      const [[pane = '', statusPath = ''] = []] = [...tmuxFake.statusPaths]

      // Still going after its call returned: a later process must be able to find it.
      expect(createRunLedger(ledgerDir).list()).toEqual([
        {
          runId: `run-${pane.slice(1)}`,
          pane,
          socket: '/tmp/tmux-fake/default',
          callId: 'call-long',
          // Handed back as still running, with its pane: a restart must leave it be.
          delivered: true,
        },
      ])

      writeFileSync(statusPath, '0')
      await terminal.executeTool('call-next', 'run', { command: 'ls', waitSeconds: 1 })

      // The first finished and is forgotten; the one still going is recorded in its place.
      expect(
        createRunLedger(ledgerDir)
          .list()
          .map((run) => run.pane)
      ).toEqual([[...tmuxFake.statusPaths.keys()][1]])
    } finally {
      tmuxFake.on = false
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('closes and then forgets a run that finished before its terminal closed', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    tmuxFake.open.clear()
    const scratch = mkdtempSync(join(tmpdir(), 'sim-ledger-'))
    const ledgerDir = join(scratch, 'terminal-runs')
    try {
      const terminal = new TerminalService({
        loadCwd: () => '/tmp',
        runLedger: createRunLedger(ledgerDir),
      })
      const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
      await terminal.executeTool('call-long', 'run', { command: 'make build', waitSeconds: 1 })
      const [[, statusPath = ''] = []] = [...tmuxFake.statusPaths]
      writeFileSync(statusPath, '0')

      const [pane = ''] = [...tmuxFake.statusPaths.keys()]
      // Its dead pane is still open, as with `remain-on-exit`.
      expect(tmuxFake.open.has(pane)).toBe(true)

      terminal.closeTerminal(activeTerminalId as string)

      await vi.waitFor(() => expect(createRunLedger(ledgerDir).list()).toEqual([]))
      expect(tmuxFake.open.has(pane)).toBe(false)
    } finally {
      tmuxFake.on = false
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it("forgets a run that finishes within its call, and a closed tab's run once its pane is gone", async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    const scratch = mkdtempSync(join(tmpdir(), 'sim-ledger-'))
    const ledgerDir = join(scratch, 'terminal-runs')
    try {
      const terminal = new TerminalService({
        loadCwd: () => '/tmp',
        runLedger: createRunLedger(ledgerDir),
      })
      const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
      // Finishes while its call still waits on it.
      const quick = terminal.executeTool('call-quick', 'run', { command: 'ls', waitSeconds: 30 })
      await vi.waitFor(() => expect(tmuxFake.statusPaths.size).toBe(1))
      writeFileSync([...tmuxFake.statusPaths.values()][0] ?? '', '0')
      await quick
      expect(createRunLedger(ledgerDir).list()).toEqual([])

      // Still going when its tab closes; its pane goes later, and the next run's bookkeeping sees.
      await terminal.executeTool('call-long', 'run', { command: 'make build', waitSeconds: 1 })
      const [, longPane = ''] = [...tmuxFake.statusPaths.keys()]
      terminal.closeTerminal(activeTerminalId as string)
      expect(
        createRunLedger(ledgerDir)
          .list()
          .map((run) => run.pane)
      ).toEqual([longPane])
      tmuxFake.gone.add(longPane)
      await terminal.executeTool('call-new', 'new', {})
      await terminal.executeTool('call-next', 'run', { command: 'pwd', waitSeconds: 1 })

      expect(
        createRunLedger(ledgerDir)
          .list()
          .map((run) => run.pane)
      ).not.toContain(longPane)
    } finally {
      tmuxFake.on = false
      tmuxFake.gone.clear()
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('keeps the record of a finished run whose pane tmux could not confirm closing', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    const scratch = mkdtempSync(join(tmpdir(), 'sim-ledger-'))
    const ledgerDir = join(scratch, 'terminal-runs')
    try {
      const terminal = new TerminalService({
        loadCwd: () => '/tmp',
        runLedger: createRunLedger(ledgerDir),
      })
      const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
      await terminal.executeTool('call-long', 'run', { command: 'make build', waitSeconds: 1 })
      writeFileSync([...tmuxFake.statusPaths.values()][0] ?? '', '0')
      tmuxFake.unanswered = true

      terminal.closeTerminal(activeTerminalId as string)
      await sleep(200)

      // The next sweep will close its pane.
      expect(createRunLedger(ledgerDir).list()).toHaveLength(1)
    } finally {
      tmuxFake.on = false
      tmuxFake.unanswered = false
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('never starts a tagged run it could not record', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    const scratch = mkdtempSync(join(tmpdir(), 'sim-ledger-'))
    // A file where the ledger's directory should be: no record can be saved.
    writeFileSync(join(scratch, 'terminal-runs'), '')
    try {
      const terminal = new TerminalService({
        loadCwd: () => '/tmp',
        runLedger: createRunLedger(join(scratch, 'terminal-runs')),
      })
      terminal.start({ cols: 80, rows: 24 })

      await expect(
        terminal.executeTool('call-unrecorded', 'run', { command: 'make build', waitSeconds: 1 })
      ).resolves.toMatchObject({ ok: false, code: 'SPAWN_FAILED' })
      expect(tmuxFake.statusPaths.size).toBe(0)
    } finally {
      tmuxFake.on = false
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it("closes a run's pane when a later run reaps it after it finished", async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    tmuxFake.open.clear()
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      terminal.start({ cols: 80, rows: 24 })
      await terminal.executeTool('call-long', 'run', { command: 'make build', waitSeconds: 1 })
      const [[pane = '', statusPath = ''] = []] = [...tmuxFake.statusPaths]
      // It finishes after its call returned, and its dead pane stays open.
      writeFileSync(statusPath, '0')
      expect(tmuxFake.open.has(pane)).toBe(true)

      await terminal.executeTool('call-next', 'run', { command: 'ls', waitSeconds: 1 })

      expect(tmuxFake.open.has(pane)).toBe(false)
    } finally {
      tmuxFake.on = false
    }
  })

  it("keeps a run's output readable for its call when the terminal goes away mid-wait", async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      terminal.start({ cols: 80, rows: 24 })
      const running = terminal.executeTool('call-tmux-closed', 'run', {
        command: 'make build',
        waitSeconds: 1,
      })
      await vi.waitFor(() => expect(tmuxFake.statusPaths.size).toBe(1))

      terminal.dispose()

      await expect(running).resolves.toMatchObject({
        ok: true,
        result: { status: 'running', output: 'partial output' },
      })
    } finally {
      tmuxFake.on = false
    }
  })

  it('releases a run whose pane is gone instead of ever stopping it', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    tmuxFake.stopped.length = 0
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      terminal.start({ cols: 80, rows: 24 })
      const first = await terminal.executeTool('call-first', 'run', {
        command: 'sleep 600',
        waitSeconds: 1,
      })
      expect(first).toMatchObject({ ok: true, result: { status: 'running' } })
      const [pane, statusPath] = [...tmuxFake.statusPaths][0] ?? []
      tmuxFake.gone.add(pane ?? '')

      await terminal.stopAgentCommands()
      expect(tmuxFake.stopped).toEqual([])

      // The next run's bookkeeping drops it for good.
      void terminal.executeTool('call-next', 'run', { command: 'ls', waitSeconds: 1 })
      await vi.waitFor(() => expect(existsSync(statusPath ?? '')).toBe(false))
      await vi.waitFor(() => expect(tmuxFake.statusPaths.size).toBe(2))
      expect(existsSync(join(statusPath ?? '', '..'))).toBe(false)
    } finally {
      tmuxFake.on = false
      tmuxFake.gone.clear()
    }
  })

  it('still stops at sign-out a run whose Sim terminal was closed', async () => {
    tmuxFake.on = true
    tmuxFake.statusPaths.clear()
    tmuxFake.stopped.length = 0
    try {
      const terminal = new TerminalService({ loadCwd: () => '/tmp' })
      const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
      const first = await terminal.executeTool('call-orphan', 'run', {
        command: 'sleep 600',
        waitSeconds: 1,
      })
      expect(first).toMatchObject({ ok: true, result: { status: 'running' } })
      terminal.closeTerminal(activeTerminalId as string)

      await terminal.stopAgentCommands()

      expect(tmuxFake.stopped).toEqual([[...tmuxFake.statusPaths.keys()][0]])
    } finally {
      tmuxFake.on = false
    }
  })
})
