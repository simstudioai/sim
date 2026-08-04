/**
 * @vitest-environment node
 */
import { tmpdir } from 'node:os'
import type { TerminalCommandEvent } from '@sim/terminal-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface StubSessionControl {
  terminalId: string
  cwd: string
  disposed: boolean
  emitData(data: string): void
  emitCommand(event: TerminalCommandEvent): void
}

interface StubSessionCallbacks {
  onData(terminalId: string, data: string): void
  onState(): void
  onCommand(event: TerminalCommandEvent): void
  onExit(terminalId: string): void
}

const { stubSessions } = vi.hoisted(() => ({
  stubSessions: [] as StubSessionControl[],
}))

vi.mock('@/main/terminal/session', () => ({
  elide: (text: string) => ({ text, truncated: false }),
  TerminalSession: {
    create: ({
      terminalId,
      cwd,
      cols,
      rows,
      callbacks,
    }: {
      terminalId: string
      cwd: string
      cols: number
      rows: number
      callbacks: StubSessionCallbacks
    }) => {
      const control: StubSessionControl = {
        terminalId,
        cwd,
        disposed: false,
        emitData: (data) => callbacks.onData(terminalId, data),
        emitCommand: (event) => callbacks.onCommand(event),
      }
      stubSessions.push(control)
      return {
        terminalId,
        cols,
        rows,
        pid: 1000 + stubSessions.length,
        env: {},
        shell: 'zsh',
        get alive() {
          return !control.disposed
        },
        currentCwd: cwd,
        foreground: null,
        isBusy: false,
        hasShellIntegration: true,
        refreshCwd: async () => {},
        dispose: () => {
          control.disposed = true
        },
        write: vi.fn(),
        resize: vi.fn(),
        tabState: (active: boolean) => ({
          terminalId,
          title: 'zsh',
          cwd,
          running: null,
          interactive: false,
          active,
        }),
        takeReplaySnapshot: () => '',
        clearScrollback: vi.fn(),
      }
    },
  },
}))

import {
  type ScopedTerminalSink,
  TerminalRegistry,
  type TerminalScopePersistence,
} from '@/main/terminal/registry'

function registry(): TerminalRegistry {
  return new TerminalRegistry()
}

function sink(): ScopedTerminalSink {
  return {
    data: vi.fn(),
    tabs: vi.fn(),
    command: vi.fn(),
  }
}

describe('TerminalRegistry', () => {
  beforeEach(() => {
    stubSessions.length = 0
  })

  it('restores each chat terminal service independently across A to B to A', () => {
    const terminals = registry()
    const events = sink()
    terminals.setSink(events)

    const firstA = terminals.start('chat-A', { cols: 80, rows: 24 })
    terminals.openTerminal('chat-A', '/tmp')
    const firstB = terminals.start('chat-B', { cols: 100, rows: 30 })

    expect(firstA.activeTerminalId).toBe('1')
    expect(firstB.activeTerminalId).toBe('1')
    expect(terminals.getTabs('chat-B').tabs).toHaveLength(1)

    terminals.switchTerminal('chat-A', '1')

    expect(terminals.getTabs('chat-A')).toMatchObject({
      activeTerminalId: '1',
      tabs: [
        { terminalId: '1', active: true },
        { terminalId: '2', active: false },
      ],
    })
    expect(terminals.getTabs('chat-B')).toMatchObject({
      activeTerminalId: '1',
      tabs: [{ terminalId: '1', active: true }],
    })

    stubSessions[0].emitData('from A')
    stubSessions[2].emitData('from B')
    const command: TerminalCommandEvent = {
      terminalId: '1',
      phase: 'start',
      command: 'pwd',
    }
    stubSessions[0].emitCommand(command)

    expect(events.data).toHaveBeenCalledWith('chat-A', '1', 'from A')
    expect(events.data).toHaveBeenCalledWith('chat-B', '1', 'from B')
    expect(events.tabs).toHaveBeenCalledWith('chat-A', expect.any(Object))
    expect(events.tabs).toHaveBeenCalledWith('chat-B', expect.any(Object))
    expect(events.command).toHaveBeenCalledWith('chat-A', command)

    terminals.dispose()
    expect(stubSessions.every((session) => session.disposed)).toBe(true)
  })

  it('migrates a provisional scope without restarting shells and retags events', () => {
    const terminals = registry()
    const events = sink()
    terminals.setSink(events)
    terminals.start('pending:new', { cols: 80, rows: 24 })
    terminals.openTerminal('pending:new', '/tmp')
    const before = terminals.getTabs('pending:new')
    const originalSessions = [...stubSessions]

    expect(terminals.migrateScope('pending:new', 'chat-resolved')).toBe(true)

    expect(terminals.getTabs('chat-resolved')).toEqual(before)
    expect(stubSessions).toEqual(originalSessions)

    stubSessions[0].emitData('after migration')
    expect(events.data).toHaveBeenLastCalledWith('chat-resolved', '1', 'after migration')

    expect(terminals.peekTabs('pending:new')).toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    expect(terminals.migrateScope('missing', 'chat-other')).toBe(true)

    terminals.dispose()
  })

  it('keeps the provisional service when persisted terminal migration collides', () => {
    const persistence: TerminalScopePersistence = {
      load: vi.fn(),
      save: vi.fn(() => true),
      migrate: vi.fn(() => false),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)
    terminals.start('pending:new', { cols: 80, rows: 24 })

    expect(terminals.migrateScope('pending:new', 'chat-existing')).toBe(false)
    expect(terminals.peekTabs('pending:new').tabs).toHaveLength(1)
    expect(terminals.peekTabs('chat-existing').tabs).toHaveLength(0)

    terminals.dispose()
  })

  it('restores saved tab directories lazily as fresh shells', () => {
    const persistedTabs = Array.from({ length: 12 }, (_, index) => ({
      cwd: index % 2 === 0 ? tmpdir() : process.cwd(),
    }))
    const persistence: TerminalScopePersistence = {
      load: vi.fn(() => ({
        v: 1 as const,
        tabs: persistedTabs,
        activeIndex: 11,
      })),
      save: vi.fn(() => true),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)

    expect(terminals.peekTabs('chat-A')).toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    expect(stubSessions).toHaveLength(0)

    const restored = terminals.start('chat-A', { cols: 120, rows: 40 })

    expect(stubSessions.map(({ cwd }) => cwd)).toEqual(persistedTabs.map(({ cwd }) => cwd))
    expect(restored).toMatchObject({
      activeTerminalId: '12',
      tabs: persistedTabs.map(({ cwd }, index) => ({
        terminalId: String(index + 1),
        cwd,
      })),
    })
    expect(persistence.save).toHaveBeenLastCalledWith('chat-A', {
      v: 1,
      tabs: persistedTabs,
      activeIndex: 11,
    })

    terminals.dispose()
  })

  it('opens a fallback shell for a saved tab whose directory no longer exists', () => {
    const missingCwd = '/definitely-does-not-exist/sim-terminal-restored-tab'
    const persistence: TerminalScopePersistence = {
      load: vi.fn(() => ({
        v: 1 as const,
        tabs: [{ cwd: tmpdir() }, { cwd: missingCwd }, { cwd: process.cwd() }],
        activeIndex: 1,
      })),
      save: vi.fn(() => true),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)

    const restored = terminals.start('chat-A', { cols: 120, rows: 40 })

    expect(stubSessions.map(({ cwd }) => cwd)).toEqual([tmpdir(), tmpdir(), process.cwd()])
    expect(restored.activeTerminalId).toBe('2')
    expect(restored.tabs).toHaveLength(3)
    expect(persistence.save).toHaveBeenLastCalledWith('chat-A', {
      v: 1,
      tabs: [{ cwd: tmpdir() }, { cwd: tmpdir() }, { cwd: process.cwd() }],
      activeIndex: 1,
    })

    terminals.dispose()
  })

  it('forgets an abandoned provisional scope instead of saving it', () => {
    const persistence: TerminalScopePersistence = {
      load: vi.fn(),
      save: vi.fn(() => true),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)
    terminals.start('pending:new', { cols: 80, rows: 24 })
    vi.mocked(persistence.save).mockClear()

    terminals.disposeScope('pending:new')

    expect(stubSessions[0].disposed).toBe(true)
    expect(persistence.save).not.toHaveBeenCalled()
    expect(persistence.disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('suspends PTYs while retaining their descriptor for fresh-shell restore', () => {
    let snapshot:
      | {
          v: 1
          tabs: Array<{ cwd: string }>
          activeIndex: number
        }
      | undefined
    const persistence: TerminalScopePersistence = {
      load: vi.fn(() => snapshot),
      save: vi.fn((_scope, nextSnapshot) => {
        snapshot = structuredClone(nextSnapshot)
        return true
      }),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)
    const rememberedCwd = tmpdir()
    terminals.start('chat-deleted', { cols: 80, rows: 24 })
    terminals.openTerminal('chat-deleted', rememberedCwd)
    terminals.switchTerminal('chat-deleted', '1')
    const originalSessions = [...stubSessions]
    const initialCwd = originalSessions[0].cwd
    vi.mocked(persistence.save).mockClear()

    expect(terminals.suspendScope('chat-deleted')).toBe(true)

    expect(originalSessions.every((session) => session.disposed)).toBe(true)
    expect(persistence.save).toHaveBeenCalledWith('chat-deleted', {
      v: 1,
      tabs: [{ cwd: initialCwd }, { cwd: rememberedCwd }],
      activeIndex: 0,
    })
    expect(persistence.disposeScope).not.toHaveBeenCalled()
    expect(terminals.peekTabs('chat-deleted')).toEqual({
      tabs: [],
      activeTerminalId: null,
    })

    expect(terminals.start('chat-deleted', { cols: 100, rows: 30 })).toEqual({
      tabs: [],
      activeTerminalId: null,
    })
    expect(() => terminals.write('chat-deleted', '1', 'stale input')).not.toThrow()
    expect(() => terminals.resize('chat-deleted', '1', 100, 30)).not.toThrow()
    expect(() => terminals.finishHandoff('chat-deleted', '1')).not.toThrow()
    expect(() => terminals.setPanelFocused('chat-deleted', false)).not.toThrow()
    expect(stubSessions).toHaveLength(2)

    terminals.activateScope('chat-deleted')
    const restored = terminals.start('chat-deleted', { cols: 100, rows: 30 })
    expect(stubSessions).toHaveLength(4)
    expect(stubSessions.slice(2).map(({ cwd }) => cwd)).toEqual([initialCwd, rememberedCwd])
    expect(restored.activeTerminalId).toBe('1')
  })

  it('kills live PTYs even when their descriptor cannot be saved', () => {
    const persistence: TerminalScopePersistence = {
      load: vi.fn(),
      save: vi.fn(() => false),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)
    terminals.start('chat-deleted', { cols: 80, rows: 24 })

    // Suspension accompanies chat deletion: a failed descriptor save must
    // never leave the deleted chat's shells running invisibly.
    expect(terminals.suspendScope('chat-deleted')).toBe(true)
    expect(stubSessions[0].disposed).toBe(true)
    expect(terminals.peekTabs('chat-deleted')).toEqual({ tabs: [], activeTerminalId: null })
  })

  it('kills live PTYs even when the descriptor save throws', () => {
    const persistence: TerminalScopePersistence = {
      load: vi.fn(),
      save: vi.fn(() => true),
      migrate: vi.fn(() => true),
      disposeScope: vi.fn(),
    }
    const terminals = new TerminalRegistry(persistence)
    terminals.start('chat-deleted', { cols: 80, rows: 24 })
    vi.mocked(persistence.save).mockImplementation(() => {
      throw new Error('keychain locked')
    })

    expect(terminals.suspendScope('chat-deleted')).toBe(true)
    expect(stubSessions[0].disposed).toBe(true)
  })

  it('routes renderer shortcuts only to the focused terminal scope', () => {
    const terminals = registry()
    terminals.start('chat-A', { cols: 80, rows: 24 })
    terminals.start('chat-B', { cols: 80, rows: 24 })
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const send = vi.fn()
    const contents = {
      isDestroyed: () => false,
      once: (event: string, callback: (...args: unknown[]) => void) =>
        listeners.set(event, callback),
      on: (event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback),
      removeListener: (event: string) => listeners.delete(event),
      send,
    }
    const ownerWindow = { webContents: contents }

    terminals.setPanelFocused('chat-B', true, contents as never)

    expect(terminals.handleFocusedShortcut(ownerWindow as never, 'reload-or-clear')).toBe(true)
    expect(send).toHaveBeenCalledWith('terminal:shortcut-command', 'clear', 'chat-B', '1')
    expect(terminals.handleFocusedShortcut(ownerWindow as never, 'zoom-in')).toBe(true)
    expect(send).toHaveBeenLastCalledWith('terminal:shortcut-command', 'zoom-in', 'chat-B', '1')

    terminals.setPanelFocused('chat-B', false, contents as never)
    expect(terminals.handleFocusedShortcut(ownerWindow as never, 'reload-or-clear')).toBe(false)
  })
})
