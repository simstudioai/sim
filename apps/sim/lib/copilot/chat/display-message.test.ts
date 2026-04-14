/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { toDisplayMessage } from './display-message'

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
          phaseLabel: undefined,
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
})
