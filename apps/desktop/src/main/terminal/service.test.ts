import { describe, expect, it, vi } from 'vitest'
import { TerminalService } from '@/main/terminal'

/** Stub sessions by terminal id, populated by the mock below. */
const { stubSessions } = vi.hoisted(() => ({
  stubSessions: new Map<
    string,
    { setBusy(busy: boolean): void; exit(): void; clearScrollback(): void }
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
        const state = { cwd, disposed: false, busy: false }
        const stub = {
          setBusy: (busy: boolean) => {
            state.busy = busy
          },
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
