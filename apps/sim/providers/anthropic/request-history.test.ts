/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { convertAnthropicRequestHistory } from '@/providers/anthropic/request-history'

describe('convertAnthropicRequestHistory', () => {
  it('merges system history into the top-level prompt and preserves ordinary messages', () => {
    const result = convertAnthropicRequestHistory({
      systemPrompt: 'Base instructions',
      providerId: 'anthropic',
      messages: [
        { role: 'system', content: 'First historical instruction' },
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Second historical instruction' },
        { role: 'assistant', content: 'Hi there' },
      ],
    })

    expect(result.systemPrompt).toBe(
      'Base instructions\n\nFirst historical instruction\n\nSecond historical instruction'
    )
    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
    ])
  })

  it('preserves modern tool IDs, parsed arguments, assistant text, and matching tool results', () => {
    const result = convertAnthropicRequestHistory({
      providerId: 'anthropic',
      messages: [
        {
          role: 'assistant',
          content: 'I will check both.',
          tool_calls: [
            {
              id: 'call-weather',
              type: 'function',
              function: { name: 'weather', arguments: '{"city":"Paris"}' },
            },
            {
              id: 'call-time',
              type: 'function',
              function: { name: 'time', arguments: '{"timezone":"UTC"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-weather', content: '' },
        { role: 'tool', tool_call_id: 'call-time', content: '00:00' },
      ],
    })

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check both.' },
          {
            type: 'tool_use',
            id: 'call-weather',
            name: 'weather',
            input: { city: 'Paris' },
          },
          {
            type: 'tool_use',
            id: 'call-time',
            name: 'time',
            input: { timezone: 'UTC' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-weather', content: '' },
          { type: 'tool_result', tool_use_id: 'call-time', content: '00:00' },
        ],
      },
    ])
  })

  it('pairs legacy function calls and results with stable deterministic IDs', () => {
    const options = {
      providerId: 'anthropic',
      messages: [
        {
          role: 'assistant' as const,
          content: 'Checking.',
          function_call: { name: 'lookup', arguments: '{"id":0}' },
        },
        { role: 'function' as const, name: 'lookup', content: 'false' },
      ],
    }

    const first = convertAnthropicRequestHistory(options)
    const second = convertAnthropicRequestHistory(options)
    const firstToolUse = first.messages[0].content[1]
    const secondToolUse = second.messages[0].content[1]

    expect(firstToolUse).toMatchObject({
      type: 'tool_use',
      name: 'lookup',
      input: { id: 0 },
    })
    expect(secondToolUse).toEqual(firstToolUse)
    expect(first.messages[1]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: (firstToolUse as { id: string }).id,
          content: 'false',
        },
      ],
    })
  })

  it.each([
    ['malformed JSON', '{"id":'],
    ['non-object JSON', '[]'],
  ])('rejects %s legacy function arguments', (_label, args) => {
    expect(() =>
      convertAnthropicRequestHistory({
        providerId: 'anthropic',
        messages: [
          {
            role: 'assistant',
            content: null,
            function_call: { name: 'lookup', arguments: args },
          },
          { role: 'function', name: 'lookup', content: 'result' },
        ],
      })
    ).toThrow(/tool "lookup"/)
  })
})
