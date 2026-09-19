/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { convertBedrockRequestHistory } from '@/providers/bedrock/request-history'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import { getConversationPrefixHash } from '@/providers/conversation-prefix'
import type { Message } from '@/providers/types'

describe('convertBedrockRequestHistory', () => {
  it('keeps parallel calls together and groups their results in the following user message', () => {
    const result = convertBedrockRequestHistory({
      model: 'bedrock/claude',
      systemPrompt: 'Base instruction',
      messages: [
        { role: 'system', content: 'Historical instruction' },
        {
          role: 'assistant',
          content: 'Checking both.',
          tool_calls: ['first', 'second'].map((id) => ({
            id,
            type: 'function',
            function: { name: 'lookup', arguments: JSON.stringify({ key: id }) },
          })),
        },
        { role: 'tool', tool_call_id: 'first', content: 'one' },
        { role: 'tool', tool_call_id: 'second', content: 'two' },
      ],
    })
    expect(result).toEqual({
      systemContent: [{ text: 'Base instruction' }, { text: 'Historical instruction' }],
      messages: [
        {
          role: 'assistant',
          content: [
            { text: 'Checking both.' },
            { toolUse: { toolUseId: 'first', name: 'lookup', input: { key: 'first' } } },
            { toolUse: { toolUseId: 'second', name: 'lookup', input: { key: 'second' } } },
          ],
        },
        {
          role: 'user',
          content: [
            { toolResult: { toolUseId: 'first', content: [{ text: 'one' }] } },
            { toolResult: { toolUseId: 'second', content: [{ text: 'two' }] } },
          ],
        },
      ],
    })
  })

  it('preserves native signed and binary redacted reasoning without duplicating portable text', () => {
    const assistant: Message = { role: 'assistant', content: 'portable copy' }
    const native = {
      role: 'assistant',
      content: [
        { reasoningContent: { reasoningText: { text: 'Reasoning', signature: 'signature' } } },
        { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } },
        { text: 'Done' },
      ],
    }
    setNativeConversationMessage(assistant, {
      protocol: 'bedrock',
      providerId: 'bedrock',
      model: 'bedrock/claude',
      binding: 'binding',
      prefixHash: getConversationPrefixHash([]),
      value: native,
    })
    expect(
      convertBedrockRequestHistory({ model: 'bedrock/claude', messages: [assistant] }).messages
    ).toEqual([native])
  })

  it('only restores signed reasoning when every preceding wire message is unchanged', () => {
    const user: Message = { role: 'user', content: 'Original task' }
    const assistant: Message = {
      role: 'assistant',
      content: 'Looking up both.',
      tool_calls: ['first', 'second'].map((id) => ({
        id,
        type: 'function',
        function: { name: 'lookup', arguments: '{}' },
      })),
    }
    const native = {
      role: 'assistant',
      content: [
        {
          reasoningContent: {
            reasoningText: { text: 'Private reasoning', signature: 'signature' },
          },
        },
        ...['first', 'second'].map((id) => ({
          toolUse: { toolUseId: id, name: 'lookup', input: {} },
        })),
      ],
    }
    const prefix = convertBedrockRequestHistory({
      model: 'bedrock/claude',
      messages: [user],
    }).messages
    setNativeConversationMessage(assistant, {
      protocol: 'bedrock',
      providerId: 'bedrock',
      model: 'bedrock/claude',
      binding: 'binding',
      prefixHash: getConversationPrefixHash(prefix),
      value: native,
    })
    const results: Message[] = [
      { role: 'tool', tool_call_id: 'first', content: 'First recorded outcome' },
      { role: 'tool', tool_call_id: 'second', content: 'Second recorded outcome' },
    ]
    const exact = convertBedrockRequestHistory({
      model: 'bedrock/claude',
      messages: [user, assistant, ...results],
    }).messages
    expect(exact[1]).toEqual(native)
    expect(exact[2].content).toHaveLength(2)

    for (const changedPrefix of [[], [{ role: 'user' as const, content: 'Edited task' }]]) {
      const changed = convertBedrockRequestHistory({
        model: 'bedrock/claude',
        messages: [...changedPrefix, assistant, ...results],
      }).messages
      expect(changed).toHaveLength(changedPrefix.length + 1)
      const receipt = JSON.stringify(changed.at(-1))
      expect(receipt).toContain('untrusted_prior_tool_execution')
      expect(receipt).toContain('First recorded outcome')
      expect(receipt).toContain('Second recorded outcome')
      expect(receipt).not.toContain('signature')
      expect(receipt).not.toContain('Private reasoning')
      expect(receipt).not.toContain('toolResult')
      expect(receipt).not.toContain('toolUse')
    }
  })

  it('projects reasoning without a prefix proof into a bounded receipt', () => {
    const assistant: Message = { role: 'assistant', content: 'x'.repeat(10000) }
    setNativeConversationMessage(assistant, {
      protocol: 'bedrock',
      providerId: 'bedrock',
      model: 'bedrock/claude',
      binding: 'binding',
      value: {
        role: 'assistant',
        content: [{ reasoningContent: { redactedContent: new Uint8Array([4]) } }],
      },
    })
    const messages = convertBedrockRequestHistory({
      model: 'bedrock/claude',
      messages: [assistant],
    }).messages
    expect(messages).toHaveLength(1)
    expect(messages[0].content?.[0].text).toContain('untrusted_prior_tool_execution')
    expect(messages[0].content?.[0].text?.length).toBeLessThanOrEqual(4096)
    expect(JSON.stringify(messages)).not.toContain('reasoningContent')
  })
})
