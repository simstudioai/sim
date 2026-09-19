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

  it('uses the same bounded format for protocol and context-size constraints', () => {
    const messages: Message[] = [{ role: 'tool', content: 'x'.repeat(10000) }]
    const record = renderConversationExecutionRecord(messages, 256)
    expect(record.role).toBe('user')
    expect(record.content!.length).toBeLessThanOrEqual(256)
    expect(record.content).toContain('untrusted_prior_tool_execution')
    expect(record.content).toContain('execution record shortened')
  })
})
