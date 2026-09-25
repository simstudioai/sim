import { describe, expect, it } from 'vitest'
import { setNativeConversationMessage } from '@/providers/conversation-metadata'
import {
  convertToGeminiFormat,
  convertUsageMetadata,
  mapToThinkingBudget,
} from '@/providers/google/utils'
import type { Message, ProviderRequest } from '@/providers/types'

describe('durable Gemini conversation history', () => {
  it('keeps assistant text and parallel calls together and batches both results', () => {
    const result = convertToGeminiFormat({
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'assistant',
          content: 'Looking up both records',
          tool_calls: ['a', 'b'].map((id) => ({
            id,
            type: 'function',
            function: { name: 'lookup', arguments: JSON.stringify({ id }) },
          })),
        },
        ...['a', 'b'].map(
          (id): Message => ({
            role: 'tool',
            tool_call_id: id,
            name: 'lookup',
            content: JSON.stringify({ value: id }),
          })
        ),
      ],
    })

    expect(result.contents).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'Looking up both records' },
          { functionCall: { id: 'a', name: 'lookup', args: { id: 'a' } } },
          { functionCall: { id: 'b', name: 'lookup', args: { id: 'b' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'a', name: 'lookup', response: { value: 'a' } } },
          { functionResponse: { id: 'b', name: 'lookup', response: { value: 'b' } } },
        ],
      },
    ])
  })

  it('restores trusted native parts without moving or changing thought signatures', () => {
    const message: Message = { role: 'assistant', content: 'portable answer' }
    const native = {
      role: 'model',
      parts: [
        { thought: true, text: 'thinking', thoughtSignature: 'opaque-one' },
        { text: 'answer', thoughtSignature: 'opaque-two' },
        { functionCall: { name: 'lookup', args: { id: 'a' } }, thoughtSignature: 'opaque-three' },
      ],
    }
    setNativeConversationMessage(message, {
      protocol: 'gemini',
      providerId: 'google',
      model: 'gemini-2.5-flash',
      binding: 'test',
      value: native,
    })

    expect(
      convertToGeminiFormat({ model: 'gemini-2.5-flash', messages: [message] }).contents
    ).toEqual([native])
  })

  it('keeps internal call identities out of native Gemini responses when the model omitted ids', () => {
    const message: Message = {
      role: 'assistant',
      content: '',
      tool_calls: ['internal-a', 'internal-b'].map((id) => ({
        id,
        type: 'function',
        function: { name: 'lookup', arguments: '{}' },
      })),
    }
    const native = {
      role: 'model',
      parts: ['a', 'b'].map((key) => ({
        functionCall: { name: 'lookup', args: { key } },
        thoughtSignature: `signature-${key}`,
      })),
    }
    setNativeConversationMessage(message, {
      protocol: 'gemini',
      providerId: 'google',
      model: 'gemini-3.5-flash',
      binding: 'test',
      value: native,
    })
    const { contents } = convertToGeminiFormat({
      model: 'gemini-3.5-flash',
      messages: [
        message,
        ...['internal-a', 'internal-b'].map(
          (id): Message => ({
            role: 'tool',
            name: 'lookup',
            tool_call_id: id,
            content: '{"found":true}',
          })
        ),
      ],
    })
    expect(contents[0]).toBe(native)
    expect(contents[1].parts).toHaveLength(2)
    expect(contents[1].parts?.every((part) => part.functionResponse?.id === undefined)).toBe(true)
    expect(JSON.stringify(contents)).not.toContain('internal-')
  })
})

describe('convertUsageMetadata', () => {
  it('carries the cached prompt subset through so callers can discount it', () => {
    expect(
      convertUsageMetadata({
        promptTokenCount: 100_000,
        cachedContentTokenCount: 80_000,
        candidatesTokenCount: 1_000,
        totalTokenCount: 101_000,
      })
    ).toEqual({
      promptTokenCount: 100_000,
      candidatesTokenCount: 1_000,
      cachedContentTokenCount: 80_000,
      totalTokenCount: 101_000,
    })
  })

  it('reports no cache hit when the field is absent or the metadata is missing', () => {
    expect(
      convertUsageMetadata({
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      }).cachedContentTokenCount
    ).toBe(0)
    expect(convertUsageMetadata(undefined).cachedContentTokenCount).toBe(0)
  })

  it('keeps the cached count a subset of the tool-use-inclusive prompt total', () => {
    const usage = convertUsageMetadata({
      promptTokenCount: 8_000,
      toolUsePromptTokenCount: 2_000,
      cachedContentTokenCount: 6_000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 40,
      totalTokenCount: 10_140,
    })

    expect(usage.promptTokenCount).toBe(10_000)
    expect(usage.candidatesTokenCount).toBe(140)
    expect(usage.cachedContentTokenCount).toBeLessThan(usage.promptTokenCount)
  })
})

describe('mapToThinkingBudget', () => {
  it('maps named levels to a within-range budget for gemini-2.5-pro (128-32768, cannot disable)', () => {
    expect(mapToThinkingBudget('gemini-2.5-pro', 'low')).toBeGreaterThanOrEqual(128)
    expect(mapToThinkingBudget('gemini-2.5-pro', 'high')).toBeLessThanOrEqual(32768)
  })

  it('strips the vertex/ prefix before looking up the model', () => {
    expect(mapToThinkingBudget('vertex/gemini-2.5-flash', 'medium')).toBe(
      mapToThinkingBudget('gemini-2.5-flash', 'medium')
    )
  })

  it('falls back to dynamic budget (-1) for models with no explicit mapping', () => {
    expect(mapToThinkingBudget('gemini-2.0-flash', 'medium')).toBe(-1)
  })

  it('falls back to the high budget for an unrecognized level on a mapped model', () => {
    expect(mapToThinkingBudget('gemini-2.5-flash', 'unknown-level')).toBe(
      mapToThinkingBudget('gemini-2.5-flash', 'high')
    )
  })
})

describe('convertToGeminiFormat', () => {
  it('should convert user message files to inline data parts', () => {
    const request: ProviderRequest = {
      model: 'gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: 'Analyze this image',
          files: [
            {
              id: 'file-1',
              key: 'workspace/ws-1/example.png',
              name: 'example.png',
              url: '/api/files/serve/workspace%2Fws-1%2Fexample.png?context=workspace',
              size: 128,
              type: 'image/png',
              base64: 'iVBORw0KGgo=',
            },
          ],
        },
      ],
    }

    const result = convertToGeminiFormat(request)

    expect(result.contents[0]).toEqual({
      role: 'user',
      parts: [
        { text: 'Analyze this image' },
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        },
      ],
    })
  })

  describe('tool message handling', () => {
    it('should convert tool message with object response correctly', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city": "London"}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_weather',
            tool_call_id: 'call_123',
            content: '{"temperature": 20, "condition": "sunny"}',
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      expect(result.contents[1].parts?.[0].functionCall).toMatchObject({
        id: 'call_123',
        name: 'get_weather',
      })
      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      expect(toolResponseContent).toBeDefined()

      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }
      expect(functionResponse?.response).toEqual({ temperature: 20, condition: 'sunny' })
      expect(typeof functionResponse?.response).toBe('object')
    })

    it('should wrap boolean true response in an object for Gemini compatibility', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Check if user exists' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_456',
                type: 'function',
                function: { name: 'user_exists', arguments: '{"userId": "123"}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'user_exists',
            tool_call_id: 'call_456',
            content: 'true', // Boolean true as JSON string
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      expect(toolResponseContent).toBeDefined()

      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      expect(functionResponse?.response).not.toBe(true)
      expect(functionResponse?.response).toEqual({ value: true })
    })

    it('should wrap string response in an object for Gemini compatibility', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Get status' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_str',
                type: 'function',
                function: { name: 'get_status', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_status',
            tool_call_id: 'call_str',
            content: '"success"', // String as JSON
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      expect(functionResponse?.response).toEqual({ value: 'success' })
    })

    it('should wrap null response in an object for Gemini compatibility', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Get data' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_null',
                type: 'function',
                function: { name: 'get_data', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_data',
            tool_call_id: 'call_null',
            content: 'null', // null as JSON
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      expect(functionResponse?.response).toEqual({ value: null })
    })

    it('should keep array response as-is since arrays are valid Struct values', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Get items' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_arr',
                type: 'function',
                function: { name: 'get_items', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_items',
            tool_call_id: 'call_arr',
            content: '["item1", "item2"]', // Array as JSON
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      expect(functionResponse?.response).toEqual({ value: ['item1', 'item2'] })
    })

    it('should handle invalid JSON by wrapping in output object', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Get data' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_invalid',
                type: 'function',
                function: { name: 'get_data', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_data',
            tool_call_id: 'call_invalid',
            content: 'not valid json {',
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      expect(functionResponse?.response).toEqual({ output: 'not valid json {' })
    })

    it('should handle empty content by wrapping in output object', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Do something' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_empty',
                type: 'function',
                function: { name: 'do_action', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'do_action',
            tool_call_id: 'call_empty',
            content: '', // Empty content - falls back to default '{}'
          },
        ],
      }

      const result = convertToGeminiFormat(request)

      const toolResponseContent = result.contents.find(
        (c) => c.parts?.[0] && 'functionResponse' in c.parts[0]
      )
      const functionResponse = (toolResponseContent?.parts?.[0] as { functionResponse?: unknown })
        ?.functionResponse as { response?: unknown }

      expect(typeof functionResponse?.response).toBe('object')
      // Empty string is not valid JSON, so it falls back to { output: "" }
      expect(functionResponse?.response).toEqual({ output: '' })
    })
  })
})
