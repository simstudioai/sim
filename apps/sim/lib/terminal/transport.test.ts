import type { ScopedTerminalCommandEvent, ScopedTerminalTabsState } from '@sim/terminal-protocol'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  activateScope,
  activateStoreScope,
  applyCommandEvent,
  clearScrollback,
  discardScope,
  disposeScope,
  getTabs,
  markScopeSuspended,
  migrateStoreScope,
  nativeMigrateScope,
  nativeOpenTerminal,
  nativeReorderTerminal,
  nativeStart,
  onCommand,
  onData,
  onDefaultZoomChanged,
  onShortcutCommand,
  onTabs,
  onScopeSuspended,
  restoreScope,
  setTabs,
  nativeSuspendScope,
  nativeSwitchTerminal,
  write,
} = vi.hoisted(() => ({
  activateScope: vi.fn(async (scopeId: string) => ({
    scopeId,
    tabs: [],
    activeTerminalId: null,
  })),
  activateStoreScope: vi.fn(),
  applyCommandEvent: vi.fn(),
  clearScrollback: vi.fn(async () => true),
  discardScope: vi.fn(),
  disposeScope: vi.fn(async () => true),
  getTabs: vi.fn(async (scopeId: string) => ({
    scopeId,
    tabs: [],
    activeTerminalId: null,
  })),
  markScopeSuspended: vi.fn(),
  migrateStoreScope: vi.fn(),
  nativeMigrateScope: vi.fn(),
  nativeOpenTerminal: vi.fn(async (_cwd: string | undefined, scopeId: string) => ({
    scopeId,
    tabs: [],
    activeTerminalId: null,
  })),
  nativeReorderTerminal: vi.fn(),
  nativeStart: vi.fn(),
  onCommand: vi.fn(),
  onData: vi.fn(() => vi.fn()),
  onDefaultZoomChanged: vi.fn(() => vi.fn()),
  onShortcutCommand: vi.fn(() => vi.fn()),
  onTabs: vi.fn(),
  onScopeSuspended: vi.fn(),
  restoreScope: vi.fn(async (scopeId: string) => ({
    scopeId,
    tabs: [],
    activeTerminalId: null,
  })),
  setTabs: vi.fn(),
  nativeSuspendScope: vi.fn(async () => true),
  nativeSwitchTerminal: vi.fn(async () => {}),
  write: vi.fn(),
}))

const bridgeTerminal = vi.hoisted(() => ({}) as Record<string, unknown>)
Object.assign(bridgeTerminal, {
  activateScope,
  closeTerminal: vi.fn(),
  clearScrollback,
  dispose: vi.fn(),
  disposeScope,
  executeTool: vi.fn(),
  getScrollback: vi.fn(),
  getTabs,
  migrateScope: nativeMigrateScope,
  onCommand,
  onData,
  onDefaultZoomChanged,
  onShortcutCommand,
  onTabs,
  onScopeSuspended,
  openTerminal: nativeOpenTerminal,
  reorderTerminal: nativeReorderTerminal,
  resize: vi.fn(),
  restoreScope,
  switchTerminal: nativeSwitchTerminal,
  suspendScope: nativeSuspendScope,
  write,
})

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({ terminal: bridgeTerminal }),
  isTerminalEnabled: () => true,
}))

vi.mock('@/stores/copilot-terminal/store', () => ({
  useCopilotTerminalStore: {
    getState: () => ({
      activeScopeId: null,
      sessions: {},
      activateScope: activateStoreScope,
      applyCommandEvent,
      discardScope,
      migrateScope: migrateStoreScope,
      suspendScope: markScopeSuspended,
      setTabs,
    }),
  },
}))

import {
  activateTerminalScope,
  clearTerminalScrollback,
  discardTerminalScope,
  initTerminalTransport,
  migrateTerminalScope,
  onTerminalData,
  onTerminalDefaultZoomChanged,
  onTerminalShortcutCommand,
  openTerminal,
  reorderTerminal,
  suspendTerminalScope,
  switchTerminal,
  writeToTerminal,
} from '@/lib/terminal/transport'

describe('terminal transport chat scopes', () => {
  beforeAll(() => {
    initTerminalTransport()
  })

  beforeEach(() => {
    applyCommandEvent.mockClear()
    clearScrollback.mockClear()
    discardScope.mockClear()
    disposeScope.mockClear()
    setTabs.mockClear()
    nativeSuspendScope.mockReset()
    nativeSuspendScope.mockResolvedValue(true)
    markScopeSuspended.mockClear()
    migrateStoreScope.mockClear()
    nativeMigrateScope.mockReset()
    nativeReorderTerminal.mockReset()
    activateScope.mockClear()
    restoreScope.mockClear()
    nativeSwitchTerminal.mockClear()
    nativeOpenTerminal.mockClear()
    nativeStart.mockClear()
    write.mockClear()
  })

  it('restores a chat with no live shells when its scope is activated', async () => {
    restoreScope.mockResolvedValueOnce({
      scopeId: 'chat-restore',
      tabs: [
        {
          terminalId: 'restored-1',
          title: 'sim',
          cwd: '/code/sim',
          running: null,
          interactive: false,
          active: true,
        },
      ],
      activeTerminalId: 'restored-1',
    })

    await activateTerminalScope('chat-restore')

    expect(restoreScope).toHaveBeenCalledWith('chat-restore')
    expect(setTabs).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeId: 'chat-restore', activeTerminalId: 'restored-1' })
    )
  })

  it('does not restore when the chat already has live shells', async () => {
    activateScope.mockResolvedValueOnce({
      scopeId: 'chat-live',
      tabs: [
        {
          terminalId: 'live-1',
          title: 'sim',
          cwd: '/code/sim',
          running: null,
          interactive: false,
          active: true,
        },
      ],
      activeTerminalId: 'live-1',
    })

    await activateTerminalScope('chat-live')

    expect(restoreScope).not.toHaveBeenCalled()
  })

  it('skips the restore when the user moved to another chat during activation', async () => {
    let finishActivation: (tabs: ScopedTerminalTabsState) => void = () => {}
    activateScope.mockImplementationOnce(
      () => new Promise<ScopedTerminalTabsState>((resolve) => (finishActivation = resolve))
    )

    const first = activateTerminalScope('chat-first')
    await activateTerminalScope('chat-second')
    finishActivation({ scopeId: 'chat-first', tabs: [], activeTerminalId: null })
    await first

    expect(restoreScope).toHaveBeenCalledExactlyOnceWith('chat-second')
  })

  it('opens a fresh shell through openTerminal on shells that restore on activation', async () => {
    await openTerminal(undefined, 'chat-b')

    expect(nativeOpenTerminal).toHaveBeenCalledWith(undefined, 'chat-b')
    expect(nativeStart).not.toHaveBeenCalled()
  })

  it('adopts a chat through start on shells that cannot restore on activation', async () => {
    const { restoreScope: modern } = bridgeTerminal
    bridgeTerminal.restoreScope = undefined
    bridgeTerminal.start = nativeStart
    try {
      await openTerminal(undefined, 'chat-b')
    } finally {
      bridgeTerminal.restoreScope = modern
      bridgeTerminal.start = undefined
    }

    expect(nativeStart).toHaveBeenCalledWith({ cols: 80, rows: 24 }, 'chat-b')
    expect(nativeOpenTerminal).not.toHaveBeenCalled()
  })

  it('forwards a terminal switch with its claim option', async () => {
    await switchTerminal('terminal-b', 'chat-b', { claim: false })

    expect(nativeSwitchTerminal).toHaveBeenCalledWith('terminal-b', 'chat-b', { claim: false })
  })

  it('routes pushed tab and command state to the scope carried by each event', () => {
    const tabsListener = onTabs.mock.calls[0][0] as (state: ScopedTerminalTabsState) => void
    const commandListener = onCommand.mock.calls[0][0] as (
      event: ScopedTerminalCommandEvent
    ) => void
    const tabs = { scopeId: 'chat-a', tabs: [] as [], activeTerminalId: null }
    const command = {
      scopeId: 'chat-b',
      terminalId: 'same-id',
      phase: 'start' as const,
      command: 'bun test',
      toolCallId: 'tool-b',
    }

    tabsListener(tabs)
    commandListener(command)

    expect(setTabs).toHaveBeenCalledWith(tabs)
    expect(applyCommandEvent).toHaveBeenCalledWith(command)
  })

  it('applies native suspension pushes to the matching renderer scope', () => {
    const listener = onScopeSuspended.mock.calls[0][0] as (scopeId: string) => void

    listener('chat-background')

    expect(markScopeSuspended).toHaveBeenCalledWith('chat-background')
  })

  it('separates output handlers for overlapping terminal ids', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = onTerminalData('same-id', a, 'chat-a')
    const unsubscribeB = onTerminalData('same-id', b, 'chat-b')
    const dataListener = onData.mock.calls[0][0] as (
      terminalId: string,
      data: string,
      scopeId: string
    ) => void

    dataListener('same-id', 'from A', 'chat-a')
    dataListener('same-id', 'from B', 'chat-b')

    expect(a).toHaveBeenCalledWith('from A')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith('from B')
    expect(b).toHaveBeenCalledTimes(1)
    unsubscribeA()
    unsubscribeB()
  })

  it('forwards user input with the explicit chat scope', () => {
    writeToTerminal('same-id', 'ls\r', 'chat-b')

    expect(write).toHaveBeenCalledWith('same-id', 'ls\r', 'chat-b')
  })

  it('forwards terminal tab reordering with the explicit chat scope', async () => {
    await reorderTerminal('terminal-b', 2, 'chat-b')

    expect(nativeReorderTerminal).toHaveBeenCalledWith('terminal-b', 2, 'chat-b')
  })

  it('clears retained terminal output in the explicit chat scope', async () => {
    await expect(clearTerminalScrollback('same-id', 'chat-b')).resolves.toBe(true)

    expect(clearScrollback).toHaveBeenCalledWith('same-id', 'chat-b')
  })

  it('routes focus commands only to the subscribed terminal scope', () => {
    const callback = vi.fn()
    onTerminalShortcutCommand(callback, 'chat-a', 'terminal-a')
    const listener = onShortcutCommand.mock.calls.at(-1)?.[0] as (
      command: 'clear',
      scopeId: string,
      terminalId?: string
    ) => void

    listener('clear', 'chat-b', 'terminal-a')
    listener('clear', 'chat-a', 'terminal-b')
    listener('clear', 'chat-a', 'terminal-a')

    expect(callback).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith('clear')
  })

  it('forwards device-wide terminal zoom baseline changes', () => {
    const callback = vi.fn()
    onTerminalDefaultZoomChanged(callback)
    const listener = onDefaultZoomChanged.mock.calls.at(-1)?.[0] as (zoom: 125) => void

    listener(125)

    expect(callback).toHaveBeenCalledWith(125)
  })

  it('forgets an abandoned provisional terminal scope on both sides', async () => {
    await discardTerminalScope('pending:new')

    expect(discardScope).toHaveBeenCalledWith('pending:new')
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('moves renderer state only after native terminal migration succeeds', async () => {
    nativeMigrateScope.mockResolvedValue({
      scopeId: 'chat-real',
      tabs: [],
      activeTerminalId: null,
    })

    await migrateTerminalScope('pending:new', 'chat-real')

    expect(nativeMigrateScope).toHaveBeenCalledWith('pending:new', 'chat-real')
    expect(migrateStoreScope).toHaveBeenCalledWith('pending:new', 'chat-real')
    expect(disposeScope).not.toHaveBeenCalled()
  })

  it('discards provisional terminals when the durable destination wins', async () => {
    nativeMigrateScope.mockResolvedValue({
      scopeId: 'pending:new',
      tabs: [],
      activeTerminalId: null,
    })

    await migrateTerminalScope('pending:new', 'chat-existing')

    expect(migrateStoreScope).not.toHaveBeenCalled()
    expect(discardScope).toHaveBeenCalledWith('pending:new')
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('drops stale renderer terminal ids after a durable scope is suspended', async () => {
    await expect(suspendTerminalScope('chat-deleted')).resolves.toBe(true)

    expect(nativeSuspendScope).toHaveBeenCalledWith('chat-deleted')
    expect(markScopeSuspended).toHaveBeenCalledWith('chat-deleted')
    await expect(suspendTerminalScope('pending:new')).resolves.toBe(false)
  })

  it('retains renderer terminal ids when native suspension fails', async () => {
    nativeSuspendScope.mockResolvedValue(false)

    await expect(suspendTerminalScope('chat-deleted')).resolves.toBe(false)

    expect(markScopeSuspended).not.toHaveBeenCalled()
  })
})
