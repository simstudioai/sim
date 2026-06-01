/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  normalizeMessage,
  type PersistedMessage,
  stripToolResultOutput,
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

  it('redacts sim_key credential tags so persisted assistant messages never re-expose the key', () => {
    const live = `Here is your key: <credential>${JSON.stringify({ value: 'sk-sim-secret-123', type: 'sim_key' })}</credential> save it.`
    const result: OrchestratorResult = {
      success: true,
      content: live,
      requestId: 'req-1',
      contentBlocks: [{ type: 'text', content: live }],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).not.toContain('sk-sim-secret-123')
    expect(persisted.content).toContain('"redacted":true')
    const textBlock = persisted.contentBlocks?.find((b) => b.type === 'text')
    expect(textBlock?.content).not.toContain('sk-sim-secret-123')
    expect(textBlock?.content).toContain('"redacted":true')
  })

  it('redacts sim_key credential tags split across streamed text chunks', () => {
    const chunks = [
      'Here\'s your key:\n\n<credential>{"value": "sk-',
      'sim-secret',
      '-12345',
      '", "type":',
      ' "sim_key"}</credential>',
      '\n\nDone.',
    ]
    const result: OrchestratorResult = {
      success: true,
      content: chunks.join(''),
      requestId: 'req-1',
      contentBlocks: chunks.map((c) => ({ type: 'text', content: c })),
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).not.toContain('sk-sim-secret-12345')
    expect(persisted.contentBlocks).toBeDefined()
    const joined = (persisted.contentBlocks ?? []).map((b) => b.content ?? '').join('')
    expect(joined).not.toContain('sk-sim-secret-12345')
    expect(joined).toContain('"redacted":true')
  })

  it('redacts the api key from a persisted generate_api_key tool result output', () => {
    const result: OrchestratorResult = {
      success: true,
      content: '',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tool-1',
            name: 'generate_api_key',
            status: 'success',
            params: { name: 'workspace-key' },
            result: {
              success: true,
              output: {
                id: 'k1',
                name: 'workspace-key',
                key: 'sk-sim-tool-output-secret',
              },
            },
          },
        },
      ],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)
    const toolBlock = persisted.contentBlocks?.find((b) => b.toolCall?.name === 'generate_api_key')
    const output = toolBlock?.toolCall?.result?.output as Record<string, unknown> | undefined

    expect(output?.key).toBe('[REDACTED]')
    expect(output?.redacted).toBe(true)
    expect(JSON.stringify(persisted)).not.toContain('sk-sim-tool-output-secret')
  })

  it('leaves non-sim_key credential tags untouched', () => {
    const live = `<credential>${JSON.stringify({ value: 'https://oauth.example/connect', type: 'link', provider: 'slack' })}</credential>`
    const result: OrchestratorResult = {
      success: true,
      content: live,
      requestId: 'req-1',
      contentBlocks: [{ type: 'text', content: live }],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).toContain('https://oauth.example/connect')
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

describe('stripToolResultOutput', () => {
  it('drops result.output but keeps success and error', () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-1',
            name: 'get_workflow_logs',
            state: 'error',
            params: { workflowId: 'wf-1' },
            display: { title: 'Reading logs' },
            result: { success: false, output: { huge: 'x'.repeat(1000) }, error: 'boom' },
          },
        },
      ],
    }

    const stripped = stripToolResultOutput(message)

    expect(stripped.contentBlocks?.[0].toolCall).toEqual({
      id: 'tool-1',
      name: 'get_workflow_logs',
      state: 'error',
      params: { workflowId: 'wf-1' },
      display: { title: 'Reading logs' },
      result: { success: false, error: 'boom' },
    })
    expect(message.contentBlocks?.[0].toolCall?.result).toHaveProperty('output')
  })

  it('omits error when the original result had none', () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 't',
            name: 'read',
            state: 'success',
            result: { success: true, output: [1, 2, 3] },
          },
        },
      ],
    }

    expect(stripToolResultOutput(message).contentBlocks?.[0].toolCall?.result).toEqual({
      success: true,
    })
  })

  it('returns the same reference when there is nothing to strip', () => {
    const noBlocks: PersistedMessage = {
      id: 'u',
      role: 'user',
      content: 'hi',
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(stripToolResultOutput(noBlocks)).toBe(noBlocks)

    const noOutput: PersistedMessage = {
      id: 'msg',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'text', channel: 'assistant', content: 'done' },
        { type: 'tool', phase: 'call', toolCall: { id: 't', name: 'read', state: 'pending' } },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 't2',
            name: 'read',
            state: 'error',
            result: { success: false, error: 'x' },
          },
        },
      ],
    }
    expect(stripToolResultOutput(noOutput)).toBe(noOutput)
  })

  it('strips every tool block while leaving text/thinking blocks intact', () => {
    const message: PersistedMessage = {
      id: 'msg',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'text', channel: 'thinking', content: 'hmm' },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'a',
            name: 'run_workflow',
            state: 'success',
            result: { success: true, output: { big: 1 } },
          },
        },
        { type: 'text', channel: 'assistant', content: 'answer' },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'b',
            name: 'read',
            state: 'success',
            result: { success: true, output: 'file contents' },
          },
        },
      ],
    }

    const blocks = stripToolResultOutput(message).contentBlocks ?? []
    expect(blocks[0]).toEqual({ type: 'text', channel: 'thinking', content: 'hmm' })
    expect(blocks[1].toolCall?.result).toEqual({ success: true })
    expect(blocks[2]).toEqual({ type: 'text', channel: 'assistant', content: 'answer' })
    expect(blocks[3].toolCall?.result).toEqual({ success: true })
    expect(JSON.stringify(blocks)).not.toContain('file contents')
  })
})
