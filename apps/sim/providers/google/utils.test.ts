/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { convertToGeminiFormat, ensureStructResponse } from '@/providers/google/utils'
import type { ProviderRequest } from '@/providers/types'

describe('ensureStructResponse', () => {
  describe('should return objects unchanged', () => {
    it('should return plain object unchanged', () => {
      const input = { key: 'value', nested: { a: 1 } }
      const result = ensureStructResponse(input)
      expect(result).toBe(input) // Same reference
      expect(result).toEqual({ key: 'value', nested: { a: 1 } })
    })

    it('should return empty object unchanged', () => {
      const input = {}
      const result = ensureStructResponse(input)
      expect(result).toBe(input)
      expect(result).toEqual({})
    })
  })

  describe('should wrap primitive values in { value: ... }', () => {
    it('should wrap boolean true', () => {
      const result = ensureStructResponse(true)
      expect(result).toEqual({ value: true })
      expect(typeof result).toBe('object')
    })

    it('should wrap boolean false', () => {
      const result = ensureStructResponse(false)
      expect(result).toEqual({ value: false })
      expect(typeof result).toBe('object')
    })

    it('should wrap string', () => {
      const result = ensureStructResponse('success')
      expect(result).toEqual({ value: 'success' })
      expect(typeof result).toBe('object')
    })

    it('should wrap empty string', () => {
      const result = ensureStructResponse('')
      expect(result).toEqual({ value: '' })
      expect(typeof result).toBe('object')
    })

    it('should wrap number', () => {
      const result = ensureStructResponse(42)
      expect(result).toEqual({ value: 42 })
      expect(typeof result).toBe('object')
    })

    it('should wrap zero', () => {
      const result = ensureStructResponse(0)
      expect(result).toEqual({ value: 0 })
      expect(typeof result).toBe('object')
    })

    it('should wrap null', () => {
      const result = ensureStructResponse(null)
      expect(result).toEqual({ value: null })
      expect(typeof result).toBe('object')
    })

    it('should wrap undefined', () => {
      const result = ensureStructResponse(undefined)
      expect(result).toEqual({ value: undefined })
      expect(typeof result).toBe('object')
    })
  })

  describe('should wrap arrays in { value: ... }', () => {
    it('should wrap array of strings', () => {
      const result = ensureStructResponse(['a', 'b', 'c'])
      expect(result).toEqual({ value: ['a', 'b', 'c'] })
      expect(typeof result).toBe('object')
      expect(Array.isArray(result)).toBe(false)
    })

    it('should wrap array of objects', () => {
      const result = ensureStructResponse([{ id: 1 }, { id: 2 }])
      expect(result).toEqual({ value: [{ id: 1 }, { id: 2 }] })
      expect(typeof result).toBe('object')
      expect(Array.isArray(result)).toBe(false)
    })

    it('should wrap empty array', () => {
      const result = ensureStructResponse([])
      expect(result).toEqual({ value: [] })
      expect(typeof result).toBe('object')
      expect(Array.isArray(result)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle nested objects correctly', () => {
      const input = { a: { b: { c: 1 } }, d: [1, 2, 3] }
      const result = ensureStructResponse(input)
      expect(result).toBe(input) // Same reference, unchanged
    })

    it('should handle object with array property correctly', () => {
      const input = { items: ['a', 'b'], count: 2 }
      const result = ensureStructResponse(input)
      expect(result).toBe(input) // Same reference, unchanged
    })
  })
})

describe('convertToGeminiFormat', () => {
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

    it('should wrap boolean false response in an object for Gemini compatibility', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Check if user exists' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_789',
                type: 'function',
                function: { name: 'user_exists', arguments: '{"userId": "999"}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'user_exists',
            tool_call_id: 'call_789',
            content: 'false', // Boolean false as JSON string
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
      expect(functionResponse?.response).toEqual({ value: false })
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

    it('should wrap number response in an object for Gemini compatibility', () => {
      const request: ProviderRequest = {
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'user', content: 'Get count' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_num',
                type: 'function',
                function: { name: 'get_count', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'get_count',
            tool_call_id: 'call_num',
            content: '42', // Number as JSON
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
      expect(functionResponse?.response).toEqual({ value: 42 })
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
