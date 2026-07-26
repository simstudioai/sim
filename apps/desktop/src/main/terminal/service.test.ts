import { describe, expect, it, vi } from 'vitest'
import { TerminalService } from '@/main/terminal'

/** Stub sessions by terminal id, populated by the mock below. */
const { stubSessions } = vi.hoisted(() => ({
  stubSessions: new Map<string, { setBusy(busy: boolean): void; exit(): void }>(),
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
  return new TerminalService({ loadCwd: () => '/tmp', saveCwd: () => {} })
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

describe('focus-gated shortcuts', () => {
  it('ignores close and reopen while the panel is not focused', () => {
    // Cmd-W and Cmd-Shift-T are global menu accelerators, so they arrive even
    // when the user is working somewhere else entirely.
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })

    expect(terminal.closeFocusedTerminal()).toBe(false)
    expect(terminal.reopenClosedTerminal()).toBe(false)
  })

  it('closes the active terminal once the panel has focus', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.openTerminal()
    terminal.setPanelFocused(true)

    expect(terminal.closeFocusedTerminal()).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(1)
  })

  it('reopens a closed terminal, and has nothing to reopen before one closes', () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    terminal.setPanelFocused(true)

    expect(terminal.reopenClosedTerminal()).toBe(false)

    const second = terminal.openTerminal()
    terminal.closeTerminal(second.activeTerminalId as string)

    expect(terminal.reopenClosedTerminal()).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(2)
  })

  it('does not remember a reset as a closed terminal to reopen', () => {
    // Resetting the last terminal replaces it in place; offering to "reopen"
    // it would just add a duplicate of the shell already on screen.
    const terminal = service()
    const started = terminal.start({ cols: 80, rows: 24 })
    terminal.setPanelFocused(true)

    terminal.closeTerminal(started.activeTerminalId as string)

    expect(terminal.reopenClosedTerminal()).toBe(false)
    expect(terminal.getTabs().tabs).toHaveLength(1)
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
  it('closes the Sim terminal when no pane is named', async () => {
    const terminal = service()
    terminal.start({ cols: 80, rows: 24 })
    const second = terminal.openTerminal()

    const response = await terminal.executeTool('call-1', 'close', {
      terminalId: second.activeTerminalId as string,
    })

    expect(response.ok).toBe(true)
    expect(terminal.getTabs().tabs).toHaveLength(1)
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
