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
    const blockTimestamp = 1_700_000_000_000
    const result: OrchestratorResult = {
      success: true,
      content: 'done',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: blockTimestamp,
          calledBy: 'workflow',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            status: 'success',
            displayTitle: 'Reading foo.txt',
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
        timestamp: blockTimestamp,
        toolCall: {
          id: 'tool-1',
          name: 'read',
          state: 'success',
          display: { title: 'Reading foo.txt' },
          params: { path: 'foo.txt' },
          result: { success: true, output: { ok: true } },
          calledBy: 'workflow',
        },
      },
      {
        type: 'text',
        channel: 'assistant',
        content: 'done',
      },
    ])
  })

  it('prefers an explicit persisted request ID override', () => {
    const result: OrchestratorResult = {
      success: true,
      content: 'done',
      requestId: 'go-trace-1',
      contentBlocks: [],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result, 'sim-request-1')

    expect(persisted.requestId).toBe('sim-request-1')
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
            display: { phaseLabel: 'Workspace' },
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
          display: { title: 'Workspace' },
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
