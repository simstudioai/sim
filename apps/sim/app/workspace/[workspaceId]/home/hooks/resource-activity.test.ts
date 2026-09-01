import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearTrackedResourceActivity,
  createResourceActivityTracker,
  excludeActivityOwnedBy,
  setTrackedBrowserRun,
} from '@/app/workspace/[workspaceId]/home/hooks/resource-activity'
import { getBrowserSession, useBrowserSessionStore } from '@/stores/browser-session/store'
import { getCopilotTerminalSession, useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

describe('resource activity tracker', () => {
  beforeEach(() => {
    useBrowserSessionStore.setState({ activeScopeId: null, sessions: {} })
    useCopilotTerminalStore.setState({
      activeScopeId: null,
      sessions: {},
      settledAgentCommandIds: [],
    })
  })

  it('clears exact old-stream activity after migration without touching a newer stream', () => {
    const browserStore = useBrowserSessionStore.getState()
    const terminalStore = useCopilotTerminalStore.getState()
    browserStore.activateScope('pending:chat')
    terminalStore.activateScope('pending:chat')
    browserStore.setAgentRunActive('pending:chat', 'browser-old', true)
    terminalStore.applyCommandEvent({
      scopeId: 'pending:chat',
      terminalId: 'terminal-1',
      phase: 'start',
      command: 'old',
      toolCallId: 'terminal-old',
    })
    const tracker = createResourceActivityTracker(1, ['pending:chat'])

    browserStore.migrateScope('pending:chat', 'chat-1')
    terminalStore.migrateScope('pending:chat', 'chat-1')
    browserStore.setAgentRunActive('chat-1', 'browser-new', true)
    terminalStore.applyCommandEvent({
      scopeId: 'chat-1',
      terminalId: 'terminal-1',
      phase: 'start',
      command: 'new',
      toolCallId: 'terminal-new',
    })

    clearTrackedResourceActivity(tracker, { hardResetActivity: false })

    expect(getBrowserSession('chat-1').agentRunIds).toEqual(['browser-new'])
    expect(getCopilotTerminalSession('chat-1')).toMatchObject({
      agentCommandTerminalIds: { 'terminal-new': 'terminal-1' },
      activityResetEpoch: 0,
    })
  })

  it('settles a browser span end after its pending scope migrates', () => {
    const browserStore = useBrowserSessionStore.getState()
    browserStore.activateScope('pending:chat')
    const tracker = createResourceActivityTracker(1, ['pending:chat'])
    setTrackedBrowserRun(tracker, 'pending:chat', 'browser-old', true)
    browserStore.migrateScope('pending:chat', 'chat-1')

    setTrackedBrowserRun(tracker, 'pending:chat', 'browser-old', false)

    expect(getBrowserSession('chat-1').agentRunIds).toEqual([])
  })

  it('does not absorb current activity when constructing a stale-generation tracker', () => {
    const browserStore = useBrowserSessionStore.getState()
    const terminalStore = useCopilotTerminalStore.getState()
    browserStore.activateScope('chat-1')
    terminalStore.activateScope('chat-1')
    browserStore.setAgentRunActive('chat-1', 'browser-new', true)
    terminalStore.applyCommandEvent({
      scopeId: 'chat-1',
      terminalId: 'terminal-1',
      phase: 'start',
      command: 'new',
      toolCallId: 'terminal-new',
    })

    const staleTracker = createResourceActivityTracker(1, ['chat-1'], {
      captureExisting: false,
    })
    clearTrackedResourceActivity(staleTracker, { hardResetActivity: false })

    expect(getBrowserSession('chat-1').agentRunIds).toEqual(['browser-new'])
    expect(getCopilotTerminalSession('chat-1').agentCommandTerminalIds).toEqual({
      'terminal-new': 'terminal-1',
    })
    expect(getCopilotTerminalSession('chat-1').activityResetEpoch).toBe(0)
  })

  it('preserves exact ids adopted by a newer reader when stale cleanup arrives late', () => {
    const browserStore = useBrowserSessionStore.getState()
    const terminalStore = useCopilotTerminalStore.getState()
    browserStore.activateScope('chat-1')
    terminalStore.activateScope('chat-1')
    browserStore.setAgentRunActive('chat-1', 'shared-browser-run', true)
    terminalStore.applyCommandEvent({
      scopeId: 'chat-1',
      terminalId: 'terminal-1',
      phase: 'start',
      command: 'shared',
      toolCallId: 'shared-terminal-tool',
    })
    const staleTracker = createResourceActivityTracker(1, ['chat-1'])
    const currentTracker = createResourceActivityTracker(2, ['chat-1'])

    excludeActivityOwnedBy(staleTracker, currentTracker)
    clearTrackedResourceActivity(staleTracker, { hardResetActivity: false })

    expect(getBrowserSession('chat-1').agentRunIds).toEqual(['shared-browser-run'])
    expect(getCopilotTerminalSession('chat-1')).toMatchObject({
      agentCommandTerminalIds: { 'shared-terminal-tool': 'terminal-1' },
      activityResetEpoch: 0,
    })
  })
})
