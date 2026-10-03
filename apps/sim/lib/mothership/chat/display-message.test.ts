import { describe, expect, it } from 'vitest'
import { getLiveAssistantMessageId } from '@/lib/mothership/chat/live-message-id'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'
import { toDisplayMessage } from './display-message'

function storedAssistant(id: string, state: string): PersistedMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: '2026-09-29T00:00:00.000Z',
    contentBlocks: [{ type: 'tool', toolCall: { id: 'call-1', name: 'read', state } }],
  } as PersistedMessage
}

describe('display-message', () => {
  it('maps canonical tool, subagent text, and cancelled complete blocks to display blocks', () => {
    const display = toDisplayMessage({
      id: 'msg-1',
      role: 'assistant',
      content: 'done',
      timestamp: '2024-01-01T00:00:00.000Z',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            state: 'cancelled',
            display: { title: 'Stopped by user' },
          },
        },
        {
          type: 'text',
          lane: 'subagent',
          channel: 'assistant',
          content: 'subagent output',
        },
        {
          type: 'complete',
          status: 'cancelled',
        },
      ],
    })

    expect(display.contentBlocks).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool-1',
          name: 'read',
          status: 'cancelled',
          displayTitle: 'Stopped by user',
          params: undefined,
          calledBy: undefined,
          result: undefined,
        },
      },
      {
        type: 'subagent_text',
        content: 'subagent output',
      },
      {
        type: 'stopped',
      },
    ])
  })

  it('hides load_agent_skill blocks from display output', () => {
    const display = toDisplayMessage({
      id: 'msg-2',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-hidden',
            name: 'load_agent_skill',
            state: 'success',
            display: { title: 'Loading skill' },
          },
        },
        {
          type: 'text',
          channel: 'assistant',
          content: 'visible text',
        },
      ],
    })

    expect(display.contentBlocks).toEqual([{ type: 'text', content: 'visible text' }])
  })

  it('preserves skipped and rejected tool outcomes', () => {
    const display = toDisplayMessage({
      id: 'msg-3',
      role: 'assistant',
      content: '',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-skipped',
            name: 'read',
            state: 'skipped',
            display: { title: 'Reading workflow' },
          },
        },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-rejected',
            name: 'run_workflow',
            state: 'rejected',
            display: { title: 'Running workflow' },
          },
        },
      ],
    })

    expect(display.contentBlocks).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool-skipped',
          name: 'read',
          status: 'skipped',
          displayTitle: 'Reading workflow',
          params: undefined,
          calledBy: undefined,
          result: undefined,
        },
      },
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool-rejected',
          name: 'run_workflow',
          status: 'rejected',
          displayTitle: 'Running workflow',
          params: undefined,
          calledBy: undefined,
          result: undefined,
        },
      },
    ])
  })

  it('keeps the dashboard id on a reopened dashboard mention', () => {
    const display = toDisplayMessage({
      id: 'msg-dashboard',
      role: 'user',
      content: '@Dashboard',
      timestamp: '2024-01-01T00:00:00.000Z',
      contexts: [{ kind: 'dashboard', label: 'Dashboard', dashboardId: 'dash-1' }],
    })

    expect(display.contexts).toEqual([
      { kind: 'dashboard', label: 'Dashboard', dashboardId: 'dash-1' },
    ])
  })

  it('preserves browser and terminal selection metadata for reopened messages', () => {
    const display = toDisplayMessage({
      id: 'msg-selection',
      role: 'user',
      content: '@Docs @Terminal',
      timestamp: '2024-01-01T00:00:00.000Z',
      contexts: [
        {
          kind: 'browser_tab',
          label: 'Docs',
          tabId: 'tab-1',
          selection: {
            text: 'Selected browser text',
            url: 'https://example.com/docs',
            title: 'Example docs',
          },
        },
        {
          kind: 'terminal_tab',
          label: 'Terminal',
          terminalId: 'terminal-1',
          selection: {
            text: 'bun test',
            startLine: 12,
            endLine: 13,
          },
        },
      ],
    })

    expect(display.contexts).toEqual([
      {
        kind: 'browser_tab',
        label: 'Docs',
        tabId: 'tab-1',
        selection: {
          text: 'Selected browser text',
          url: 'https://example.com/docs',
          title: 'Example docs',
        },
      },
      {
        kind: 'terminal_tab',
        label: 'Terminal',
        terminalId: 'terminal-1',
        selection: {
          text: 'bun test',
          startLine: 12,
          endLine: 13,
        },
      },
    ])
  })

  it.each(['pending', 'executing', 'awaiting_approval'])(
    'shows a %s row of a stored message as interrupted, not running',
    (state) => {
      const display = toDisplayMessage(storedAssistant('assistant-1', state))

      expect(display.contentBlocks?.[0].toolCall?.status).toBe('interrupted')
    }
  )

  it('keeps a running row of the live message running', () => {
    const display = toDisplayMessage(
      storedAssistant(getLiveAssistantMessageId('stream-1'), 'executing')
    )

    expect(display.contentBlocks?.[0].toolCall?.status).toBe('executing')
  })
})
