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

  it('resets the last terminal instead of emptying the panel', () => {
    // A panel whose resource IS a terminal must never be left with no shell:
    // there is nothing to show and no way back from inside it.
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const onlyId = started.activeTerminalId as string

    const after = terminal.closeTerminal(onlyId)

    expect(after.tabs).toHaveLength(1)
    expect(after.activeTerminalId).not.toBe(onlyId)
  })

  it('refuses to close a terminal that does not exist', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })

    expect(() => terminal.closeTerminal('no-such-terminal')).toThrow()
  })
})

describe('reordering terminals', () => {
  it('moves a terminal without changing the active shell', () => {
    const terminal = service()
    const first = terminal.start({ cols: 80, rows: 24 }).activeTerminalId as string
    const second = terminal.openTerminal().activeTerminalId as string
    const third = terminal.openTerminal().activeTerminalId as string

    const after = terminal.reorderTerminal(first, 2)

    expect(after.tabs.map((tab) => tab.terminalId)).toEqual([second, third, first])
    expect(after.activeTerminalId).toBe(third)
  })

  it('clamps the destination and rejects an unknown terminal', () => {
    const terminal = service()
    const first = terminal.start({ cols: 80, rows: 24 }).activeTerminalId as string
    const second = terminal.openTerminal().activeTerminalId as string

    expect(terminal.reorderTerminal(second, -100).tabs.map((tab) => tab.terminalId)).toEqual([
      second,
      first,
    ])
    expect(() => terminal.reorderTerminal('no-such-terminal', 0)).toThrow()
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

  it('closes the active terminal once the panel has focus', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(1)
  })

  it('keeps tab shortcuts routed while the terminal panel is visible without focus', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    terminal.setPanelVisible(true, renderer.contents)

    expect(runShortcut(terminal, 'new-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(2)
    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(1)
    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(2)
    expect(runShortcut(terminal, 'focus-omnibox', renderer.window)).toBe(false)

    terminal.setPanelVisible(false, renderer.contents)
    expect(runShortcut(terminal, 'new-tab', renderer.window)).toBe(false)
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

  it('opens tabs in main and sends canvas commands to the focused renderer', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    const emit = vi.fn()
    terminal.setPanelFocused(true, renderer.contents)

    expect(runShortcut(terminal, 'new-tab', renderer.window, emit)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(2)
    expect(emit).not.toHaveBeenCalled()

    expect(runShortcut(terminal, 'reload-or-clear', renderer.window, emit)).toBe(true)
    expect(
      stubSessions.get(terminal.getTabs().activeTerminalId as string)?.clearScrollback
    ).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenLastCalledWith('clear', terminal.getTabs().activeTerminalId)
    expect(runShortcut(terminal, 'zoom-in', renderer.window, emit)).toBe(true)
    expect(emit).toHaveBeenLastCalledWith('zoom-in', terminal.getTabs().activeTerminalId)
    expect(runShortcut(terminal, 'zoom-out', renderer.window, emit)).toBe(true)
    expect(emit).toHaveBeenLastCalledWith('zoom-out', terminal.getTabs().activeTerminalId)
    expect(runShortcut(terminal, 'zoom-reset', renderer.window, emit)).toBe(true)
    expect(emit).toHaveBeenLastCalledWith('zoom-reset', terminal.getTabs().activeTerminalId)
  })

  it('switches tabs with cycle and numbered shortcuts', () => {
    const terminal = service()
    const first = terminal.start({ cols: 80, rows: 24 }).activeTerminalId as string
    const second = terminal.openTerminal().activeTerminalId as string
    const third = terminal.openTerminal().activeTerminalId as string
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    expect(runShortcut(terminal, 'next-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().activeTerminalId).toBe(first)
    expect(runShortcut(terminal, 'previous-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().activeTerminalId).toBe(third)
    expect(runShortcut(terminal, 'select-tab-2', renderer.window)).toBe(true)
    expect(terminal.getTabs().activeTerminalId).toBe(second)
    expect(runShortcut(terminal, 'select-tab-9', renderer.window)).toBe(true)
    expect(terminal.getTabs().activeTerminalId).toBe(third)
  })

  it('claims reopen even with no history, then reopens the latest closed terminal', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(true)

    const second = terminal.openTerminal()
    terminal.closeTerminal(second.activeTerminalId as string)

    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(2)
  })

  it('does not remember a reset as a closed terminal to reopen', () => {
    // Resetting the last terminal replaces it in place; offering to "reopen"
    // it would just add a duplicate of the shell already on screen.
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    terminal.closeTerminal(started.activeTerminalId as string)

    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(1)
  })

  it('drops the focus claim when the renderer that made it reloads', () => {
    // A reload never runs the renderer's cleanup, so nothing sends focus:false.
    // The claim used to latch true forever, and the next Cmd-W destroyed a
    // shell the user could no longer see.
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    renderer.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(false)
    expect(terminal.getTabs().tabs).toHaveLength(2)
  })

  it('keeps the claim across a same-document route change', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    renderer.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(true)
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

  it('opens and reopens more than eight terminals', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    const closed = terminal.openTerminal('/alpha')
    terminal.closeTerminal(closed.activeTerminalId as string)
    while (terminal.getTabs().tabs.length < 12) terminal.openTerminal()

    expect(runShortcut(terminal, 'reopen-closed-tab', renderer.window)).toBe(true)
    const reopened = terminal.getTabs()
    expect(reopened.tabs).toHaveLength(13)
    expect(
      reopened.tabs.find(({ terminalId }) => terminalId === reopened.activeTerminalId)?.cwd
    ).toBe('/alpha')
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

  it('honours a blur from the renderer that does hold the claim', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    const holder = rendererStub()
    terminal.setPanelFocused(true, holder.contents)

    terminal.setPanelFocused(false, holder.contents)

    expect(runShortcut(terminal, 'close-tab', holder.window)).toBe(false)
  })

  it('drops the focus claim when the whole service is disposed', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const renderer = rendererStub()
    terminal.setPanelFocused(true, renderer.contents)

    terminal.dispose()
    // A fresh shell after teardown, so this asserts the CLAIM was dropped
    // rather than passing on the "no active terminal" arm.
    terminal.start({ cols: 80, rows: 24 })

    expect(runShortcut(terminal, 'close-tab', renderer.window)).toBe(false)
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

  it('ignores a hand-back for a terminal that is not waiting', () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })

    expect(() => terminal.finishHandoff(started.activeTerminalId as string)).not.toThrow()
  })

  it('resumes in the same terminal after the user explicitly hands it back', async () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const id = started.activeTerminalId as string
    stubSessions.get(id)?.setBusy(true)
    const renderer = rendererStub()

    const handoff = terminal.executeTool('call-handoff', 'handoff', {
      terminalId: id,
      reason: 'Sign in',
    })
    terminal.setPanelFocused(true, renderer.contents)
    setTimeout(() => {
      terminal.finishHandoff(id)
      stubSessions.get(id)?.setBusy(false)
    }, 20)
    await handoff

    const resumed = await terminal.executeTool('call-cwd', 'cwd', { terminalId: id })
    expect((resumed.result as { terminalId: string }).terminalId).toBe(id)
    expect(terminal.getTabs().tabs).toHaveLength(1)
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

  it('opens and closes an agent terminal without changing visible selection', async () => {
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    const visible = terminal.openTerminal().activeTerminalId as string

    const opened = await terminal.executeTool('call-new', 'new', {})
    const agentTerminalId = (opened.result as { activeTerminalId: string | null } | undefined)
      ?.activeTerminalId

    expect(opened.ok).toBe(true)
    expect(agentTerminalId).toBeTruthy()
    expect(terminal.getTabs().activeTerminalId).toBe(visible)
    expect(terminal.getTabs().agentActiveTerminalId).toBe(agentTerminalId)
    expect(terminal.getTabs().activeTerminalId).not.toBe(started.activeTerminalId)

    const closed = await terminal.executeTool('call-close', 'close', {
      terminalId: agentTerminalId as string,
    })
    expect(closed.ok).toBe(true)
    expect(terminal.getTabs().activeTerminalId).toBe(visible)
  })

  it('refuses to close a pane in a terminal that has no tmux', async () => {
    // Naming a pane in a plain shell is a mistake worth saying out loud, not
    // silently closing the whole terminal instead.
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })

    const response = await terminal.executeTool('call-1', 'close', {
      terminalId: started.activeTerminalId as string,
      pane: 'main:1.0',
    })

    expect(response.ok).toBe(false)
    expect(response.code).toBe('NO_TMUX')
    expect(terminal.getTabs().tabs).toHaveLength(1)
  })
})

describe('a shell that ends by itself', () => {
  it('replaces the only terminal instead of leaving a dead tab', () => {
    const terminal = service()
    const { activeTerminalId } = terminal.start({ cols: 80, rows: 24 })
    const original = activeTerminalId as string

    stubSessions.get(original)?.exit()

    // The panel's whole content is the terminal, so an exited last shell used
    // to sit there unusable — nothing to type into and no way to get it back.
    const after = terminal.getTabs()
    expect(after.tabs).toHaveLength(1)
    expect(after.activeTerminalId).not.toBe(original)
    expect(after.tabs[0]?.terminalId).toBe(after.activeTerminalId)
  })

  it('removes one of several and activates a neighbour', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const second = terminal.openTerminal().activeTerminalId as string

    stubSessions.get(second)?.exit()

    const after = terminal.getTabs()
    expect(after.tabs.map((tab) => tab.terminalId)).not.toContain(second)
    expect(after.tabs).toHaveLength(1)
    expect(after.activeTerminalId).toBe(after.tabs[0]?.terminalId)
  })
})
