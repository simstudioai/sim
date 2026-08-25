import { describe, expect, it } from 'vitest'
import { getOpenAICompatibleApiBaseUrl } from '@/providers/openai-compat/base-url'

describe('getOpenAICompatibleApiBaseUrl', () => {
  it.each([
    ['http://localhost:8000', 'http://localhost:8000/v1'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['https://models.example.com/gateway/', 'https://models.example.com/gateway/v1'],
    ['https://models.example.com/gateway/v1/', 'https://models.example.com/gateway/v1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(getOpenAICompatibleApiBaseUrl(input)).toBe(expected)
  })

  it.each(['http://localhost:8000?token=value', 'http://localhost:8000#models'])(
    'rejects unsupported URL components in %s',
    (input) => {
      expect(() => getOpenAICompatibleApiBaseUrl(input)).toThrow(
        'OpenAI-compatible base URL must not include query parameters or a fragment'
      )
    }
  )
})
