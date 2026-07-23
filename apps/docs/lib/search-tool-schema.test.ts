import { describe, expect, it } from 'vitest'
import { validateSearchDocsInput } from './search-tool-schema'

describe('search documentation tool schema', () => {
  it('accepts exactly one string query', () => {
    expect(validateSearchDocsInput({ query: 'SSO setup' })).toEqual({
      success: true,
      value: { query: 'SSO setup' },
    })
  })

  it.each([
    ['null', null],
    ['array', []],
    ['missing query', {}],
    ['non-string query', { query: 7 }],
    ['extra properties', { query: 'SSO setup', unexpected: true }],
  ])('rejects malformed input: %s', (_label, value) => {
    expect(validateSearchDocsInput(value)).toMatchObject({
      success: false,
      error: expect.any(TypeError),
    })
  })
})
