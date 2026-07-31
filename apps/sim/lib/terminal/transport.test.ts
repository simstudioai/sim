import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applyCommandEvent,
  discardScope,
  disposeScope,
  getTabs,
  markScopeSuspended,
  migrateStoreScope,
  nativeMigrateScope,
  onCommand,
  onData,
  onTabs,
  onScopeSuspended,
  setTabs,
  nativeSuspendScope,
  write,
} = vi.hoisted(() => ({
  applyCommandEvent: vi.fn(),
  discardScope: vi.fn(),
  disposeScope: vi.fn(async () => true),
  getTabs: vi.fn(async (scopeId?: string) => ({
    scopeId,
    tabs: [],
    activeTerminalId: null,
  })),
  markScopeSuspended: vi.fn(),
  migrateStoreScope: vi.fn(),
  nativeMigrateScope: vi.fn(),
  onCommand: vi.fn(),
  onData: vi.fn(() => vi.fn()),
  onTabs: vi.fn(),
  onScopeSuspended: vi.fn(),
  setTabs: vi.fn(),
  nativeSuspendScope: vi.fn(async () => true),
  write: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({
  getDesktopBridge: () => ({
    terminal: {
      closeTerminal: vi.fn(),
      dispose: vi.fn(),
      disposeScope,
      executeTool: vi.fn(),
      getScrollback: vi.fn(),
      getTabs,
      migrateScope: nativeMigrateScope,
      onCommand,
      onData,
      onTabs,
      onScopeSuspended,
      openTerminal: vi.fn(),
      resize: vi.fn(),
      start: vi.fn(),
      switchTerminal: vi.fn(),
      suspendScope: nativeSuspendScope,
      write,
    },
  }),
  isTerminalEnabled: () => true,
}))

vi.mock('@/stores/copilot-terminal/store', () => ({
  LEGACY_TERMINAL_SCOPE: 'legacy',
  useCopilotTerminalStore: {
    getState: () => ({
      activeScopeId: 'legacy',
      applyCommandEvent,
      discardScope,
      migrateScope: migrateStoreScope,
      suspendScope: markScopeSuspended,
      setTabs,
    }),
  },
}))

import {
  discardTerminalScope,
  initTerminalTransport,
  migrateTerminalScope,
  onTerminalData,
  suspendTerminalScope,
  writeToTerminal,
} from '@/lib/terminal/transport'

describe('terminal transport chat scopes', () => {
  beforeAll(() => {
    initTerminalTransport()
  })

  beforeEach(() => {
    applyCommandEvent.mockClear()
    discardScope.mockClear()
    disposeScope.mockClear()
    setTabs.mockClear()
    nativeSuspendScope.mockReset()
    nativeSuspendScope.mockResolvedValue(true)
    markScopeSuspended.mockClear()
    migrateStoreScope.mockClear()
    nativeMigrateScope.mockReset()
    write.mockClear()
  })

  it('routes pushed tab and command state to the scope carried by each event', () => {
    const tabsListener = onTabs.mock.calls[0][0] as (state: {
      scopeId?: string
      tabs: []
      activeTerminalId: null
    }) => void
    const commandListener = onCommand.mock.calls[0][0] as (event: {
      scopeId?: string
      terminalId: string
      phase: 'start'
      command: string
      toolCallId: string
    }) => void
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

    expect(setTabs).toHaveBeenCalledWith(tabs, 'chat-a')
    expect(applyCommandEvent).toHaveBeenCalledWith(command, 'chat-b')
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
      scopeId?: string
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
    nativeMigrateScope.mockResolvedValue({ tabs: [], activeTerminalId: null })

    await migrateTerminalScope('pending:new', 'chat-existing')

    expect(migrateStoreScope).not.toHaveBeenCalled()
    expect(discardScope).toHaveBeenCalledWith('pending:new')
    expect(disposeScope).toHaveBeenCalledWith('pending:new')
  })

  it('drops stale renderer terminal ids after a durable scope is suspended', async () => {
    await expect(suspendTerminalScope('chat-deleted')).resolves.toBe(true)

    expect(nativeSuspendScope).toHaveBeenCalledWith('chat-deleted')
    expect(markScopeSuspended).toHaveBeenCalledWith('chat-deleted')
    await expect(suspendTerminalScope('legacy')).resolves.toBe(false)
  })

  it('retains renderer terminal ids when native suspension fails', async () => {
    nativeSuspendScope.mockResolvedValue(false)

    await expect(suspendTerminalScope('chat-deleted')).resolves.toBe(false)

    expect(markScopeSuspended).not.toHaveBeenCalled()
  })
})
