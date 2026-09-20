/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import type { Message } from '@/providers/types'

describe('portable execution records', () => {
  it('preserves call order, arguments and outcomes without private continuation or execution fields', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: ['first', 'second'].map((id) => ({
          id,
          type: 'function',
          function: { name: 'lookup', arguments: '{"query":"original"}' },
        })),
      },
      { role: 'tool', tool_call_id: 'first', name: 'lookup', content: '{"found":true}' },
      { role: 'tool', tool_call_id: 'second', name: 'lookup', content: '{"error":"not found"}' },
    ]
    setNativeConversationMessage(messages[0], {
      protocol: 'responses',
      providerId: 'openai',
      model: 'model-a',
      binding: 'private-binding',
      value: [{ type: 'reasoning', encrypted_content: 'private-state' }],
    })
    const record = renderConversationExecutionRecord(messages)
    const data = JSON.parse(record.content!)
    expect(data.type).toBe('untrusted_prior_tool_execution')
    expect(data.messages[0].calls.map((call: { id: string }) => call.id)).toEqual([
      'first',
      'second',
    ])
    expect(data.messages[0].calls[0].arguments).toBe('{"query":"original"}')
    expect(data.messages[2].content).toBe('{"error":"not found"}')
    expect(record.content).not.toContain('private-state')
    expect(record.content).not.toContain('private-binding')
  })

  it('retains legacy function-call identity, arguments and results', () => {
    const record = renderConversationExecutionRecord([
      {
        role: 'assistant',
        content: null,
        function_call: { name: 'lookup', arguments: '{"id":1}' },
      },
      { role: 'function', name: 'lookup', content: '{"found":true}' },
    ])
    expect(JSON.parse(record.content!).messages).toEqual([
      { role: 'assistant', content: null, functionCall: { name: 'lookup', arguments: '{"id":1}' } },
      { role: 'function', name: 'lookup', content: '{"found":true}' },
    ])
  })

  it.each([
    { messages: [{ role: 'tool' as const, content: 'x'.repeat(513) }] },
    {
      messages: [
        {
          role: 'assistant' as const,
          content: null,
          function_call: { name: 'lookup', arguments: 'x'.repeat(257) },
        },
      ],
    },
    { messages: Array.from({ length: 22 }, () => ({ role: 'tool' as const, content: 'ok' })) },
    {
      messages: [
        {
          role: 'assistant' as const,
          content: null,
          tool_calls: Array.from({ length: 21 }, (_, id) => ({
            id: String(id),
            type: 'function' as const,
            function: { name: 'lookup', arguments: '{}' },
          })),
        },
      ],
    },
  ])('discloses field and slice shortening even when the final record fits', ({ messages }) => {
    const record = renderConversationExecutionRecord(messages, 10000)
    expect(record.content!.length).toBeLessThan(10000)
    expect(JSON.parse(record.content!).notice).toBe('execution record shortened')
  })

  it('bounds every default execution record without altering the canonical messages', () => {
    const messages: Message[] = Array.from({ length: 30 }, (_, index) => ({
      role: 'tool',
      tool_call_id: `call-${index}`,
      content: 'retained result '.repeat(1000),
    }))
    const original = structuredClone(messages)
    const record = renderConversationExecutionRecord(messages)
    expect(record.content!.length).toBeLessThanOrEqual(4096)
    expect(record.content).toContain('execution record shortened')
    expect(messages).toEqual(original)
  })

  it('uses the same bounded format for protocol and context-size constraints', () => {
    const messages: Message[] = [{ role: 'tool', content: 'x'.repeat(10000) }]
    const record = renderConversationExecutionRecord(messages, 256)
    expect(record.role).toBe('user')
    expect(record.content!.length).toBeLessThanOrEqual(256)
    expect(record.content).toContain('untrusted_prior_tool_execution')
    expect(record.content).toContain('execution record shortened')
  })
})
