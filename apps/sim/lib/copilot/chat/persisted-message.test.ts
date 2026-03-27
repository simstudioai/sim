/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  normalizeMessage,
} from './persisted-message'

describe('persisted-message', () => {
  it('round-trips canonical tool blocks through normalizeMessage', () => {
    const result: OrchestratorResult = {
      success: true,
      content: 'done',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: Date.now(),
          calledBy: 'build',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            status: 'success',
            params: { path: 'foo.txt' },
            result: { success: true, output: { ok: true } },
          },
        },
      ],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)
    const normalized = normalizeMessage(persisted as unknown as Record<string, unknown>)

    expect(normalized.contentBlocks).toEqual([
      {
        type: 'tool',
        phase: 'call',
        toolCall: {
          id: 'tool-1',
          name: 'read',
          state: 'success',
          params: { path: 'foo.txt' },
          result: { success: true, output: { ok: true } },
          calledBy: 'build',
        },
      },
      {
        type: 'text',
        channel: 'assistant',
        content: 'done',
      },
    ])
  })

  it('normalizes legacy tool_call and top-level toolCalls shapes', () => {
    const normalized = normalizeMessage({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            state: 'cancelled',
            display: { text: 'Stopped by user' },
          },
        },
      ],
      toolCalls: [
        {
          id: 'tool-2',
          name: 'glob',
          status: 'success',
          result: { matches: [] },
        },
      ],
    })

    expect(normalized.contentBlocks).toEqual([
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
        channel: 'assistant',
        content: 'hello',
      },
    ])
  })

  it('builds normalized user messages with stripped optional empties', () => {
    const msg = buildPersistedUserMessage({
      id: 'user-1',
      content: 'hello',
      fileAttachments: [],
      contexts: [],
    })

    expect(msg).toMatchObject({
      id: 'user-1',
      role: 'user',
      content: 'hello',
    })
    expect(msg.fileAttachments).toBeUndefined()
    expect(msg.contexts).toBeUndefined()
  })
})
