/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import { providerHistoryAdapters, providerHistoryProtocols } from '@/providers/history-adapters'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const fixtures: Array<{ protocol: ConversationProtocol; value: unknown }> = [
  {
    protocol: 'responses',
    value: [
      { type: 'reasoning', encrypted_content: 'private-state', summary: [] },
      {
        type: 'function_call',
        id: 'response-item-id',
        call_id: 'call-1',
        name: 'tool-a',
        arguments: '{"first":1}',
      },
      { type: 'function_call', call_id: 'call-2', name: 'tool-b', arguments: '{"second":2}' },
    ],
  },
  {
    protocol: 'chat-completions',
    value: {
      role: 'assistant',
      content: null,
      reasoning_content: 'private-state',
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'tool-a', arguments: '{"first":1}' } },
        { id: 'call-2', type: 'function', function: { name: 'tool-b', arguments: '{"second":2}' } },
      ],
    },
  },
  {
    protocol: 'anthropic',
    value: [
      { type: 'thinking', thinking: 'private-state', signature: 'private-signature' },
      { type: 'tool_use', id: 'call-1', name: 'tool-a', input: { first: 1 } },
      { type: 'tool_use', id: 'call-2', name: 'tool-b', input: { second: 2 } },
    ],
  },
  {
    protocol: 'gemini',
    value: {
      role: 'model',
      parts: [
        { text: 'private-state', thought: true },
        {
          functionCall: { id: 'call-1', name: 'tool-a', args: { first: 1 } },
          thoughtSignature: 'private-signature',
        },
        { functionCall: { id: 'call-2', name: 'tool-b', args: { second: 2 } } },
      ],
    },
  },
  {
    protocol: 'bedrock',
    value: {
      role: 'assistant',
      content: [
        {
          reasoningContent: {
            reasoningText: { text: 'private-state', signature: 'private-signature' },
          },
        },
        { toolUse: { toolUseId: 'call-1', name: 'tool-a', input: { first: 1 } } },
        { toolUse: { toolUseId: 'call-2', name: 'tool-b', input: { second: 2 } } },
      ],
    },
  },
]

describe('canonical provider wire adapters', () => {
  it.each(fixtures)(
    'captures ordered parallel tool-only $protocol messages without private reasoning',
    ({ protocol, value }) => {
      const captured = providerHistoryAdapters[protocol].capture(value)
      expect(captured.assistant).toEqual({ role: 'assistant', content: '' })
      expect(captured.calls).toEqual([
        { providerCallId: 'call-1', toolId: 'tool-a', arguments: '{"first":1}' },
        { providerCallId: 'call-2', toolId: 'tool-b', arguments: '{"second":2}' },
      ])
      expect(JSON.stringify(captured)).not.toContain('private-state')
      expect(JSON.stringify(captured)).not.toContain('private-signature')
    }
  )

  it.each([
    [
      'responses',
      [{ type: 'message', content: [{ type: 'output_text', text: '{"answer":true}' }] }],
    ],
    ['chat-completions', { role: 'assistant', content: '{"answer":true}' }],
    ['anthropic', [{ type: 'text', text: '{"answer":true}' }]],
    ['gemini', { role: 'model', parts: [{ text: '{"answer":true}' }] }],
    ['bedrock', { role: 'assistant', content: [{ text: '{"answer":true}' }] }],
  ] as Array<[ConversationProtocol, unknown]>)(
    'preserves structured final text for %s',
    (protocol, value) => {
      expect(providerHistoryAdapters[protocol].capture(value)).toEqual({
        assistant: { role: 'assistant', content: '{"answer":true}' },
        calls: [],
      })
    }
  )

  it('does not fabricate provider IDs for Gemini or repair malformed model arguments', () => {
    expect(
      providerHistoryAdapters.gemini.capture({
        parts: [{ functionCall: { name: 'tool', args: {} } }],
      }).calls
    ).toEqual([{ toolId: 'tool', arguments: '{}' }])
    expect(
      providerHistoryAdapters['chat-completions'].capture({
        tool_calls: [{ id: 'wire', function: { name: 'tool', arguments: '{malformed' } }],
      }).calls[0].arguments
    ).toBe('{malformed')
  })

  it('maps every registered provider to a supported protocol family', () => {
    expect(Object.keys(providerHistoryProtocols).sort()).toEqual(
      Object.keys(PROVIDER_DEFINITIONS).sort()
    )
    for (const protocol of Object.values(providerHistoryProtocols))
      expect(providerHistoryAdapters[protocol]).toBeDefined()
  })
})
