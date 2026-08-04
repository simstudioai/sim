import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockOpenTerminal, mockSendBrowserPanelAction } = vi.hoisted(() => ({
  mockOpenTerminal: vi.fn(),
  mockSendBrowserPanelAction: vi.fn(),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: vi.fn(() => true),
  sendBrowserPanelAction: mockSendBrowserPanelAction,
}))

vi.mock('@/lib/terminal/transport', () => ({
  isTerminalAvailable: vi.fn(() => true),
  openTerminal: mockOpenTerminal,
}))

import { openExistingResourceTab } from './resource-tabs'

describe('openExistingResourceTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects an existing browser resource and opens a new browser tab', () => {
    const selectResource = vi.fn()

    openExistingResourceTab(
      { type: 'browser', id: 'browser-session', title: 'Browser' },
      'chat-1',
      selectResource
    )

    expect(selectResource).toHaveBeenCalledWith('browser-session')
    expect(mockSendBrowserPanelAction).toHaveBeenCalledWith('new-tab', {}, 'chat-1')
    expect(mockOpenTerminal).not.toHaveBeenCalled()
  })

  it('selects an existing terminal resource and opens a new terminal tab', () => {
    const selectResource = vi.fn()

    openExistingResourceTab(
      { type: 'terminal', id: 'terminal-session', title: 'Terminal' },
      'chat-2',
      selectResource
    )

    expect(selectResource).toHaveBeenCalledWith('terminal-session')
    expect(mockOpenTerminal).toHaveBeenCalledWith(undefined, 'chat-2')
    expect(mockSendBrowserPanelAction).not.toHaveBeenCalled()
  })

  it('only selects other existing resource types', () => {
    const selectResource = vi.fn()

    openExistingResourceTab(
      { type: 'workflow', id: 'workflow-1', title: 'Workflow' },
      'chat-3',
      selectResource
    )

    expect(selectResource).toHaveBeenCalledWith('workflow-1')
    expect(mockSendBrowserPanelAction).not.toHaveBeenCalled()
    expect(mockOpenTerminal).not.toHaveBeenCalled()
  })
})
