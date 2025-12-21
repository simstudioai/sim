import { describe, expect, it } from 'vitest'
import { normalizeName } from './utils'

describe('normalizeName', () => {
  it.concurrent('should convert to lowercase', () => {
    expect(normalizeName('MyVariable')).toBe('myvariable')
    expect(normalizeName('UPPERCASE')).toBe('uppercase')
    expect(normalizeName('MixedCase')).toBe('mixedcase')
  })

  it.concurrent('should remove spaces', () => {
    expect(normalizeName('my variable')).toBe('myvariable')
    expect(normalizeName('my  variable')).toBe('myvariable')
    expect(normalizeName('  spaced  ')).toBe('spaced')
  })

  it.concurrent('should handle both lowercase and space removal', () => {
    expect(normalizeName('JIRA TEAM UUID')).toBe('jirateamuuid')
    expect(normalizeName('My Block Name')).toBe('myblockname')
    expect(normalizeName('API 1')).toBe('api1')
  })

  it.concurrent('should handle edge cases', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName('   ')).toBe('')
    expect(normalizeName('a')).toBe('a')
    expect(normalizeName('already_normalized')).toBe('already_normalized')
  })

  it.concurrent('should preserve non-space special characters', () => {
    expect(normalizeName('my-variable')).toBe('my-variable')
    expect(normalizeName('my_variable')).toBe('my_variable')
    expect(normalizeName('my.variable')).toBe('my.variable')
  })

  it.concurrent('should handle tabs and newlines as whitespace', () => {
    expect(normalizeName('my\tvariable')).toBe('myvariable')
    expect(normalizeName('my\nvariable')).toBe('myvariable')
    expect(normalizeName('my\r\nvariable')).toBe('myvariable')
  })

  it.concurrent('should handle unicode characters', () => {
    expect(normalizeName('Café')).toBe('café')
    expect(normalizeName('日本語')).toBe('日本語')
  })

  it.concurrent('should normalize block names correctly', () => {
    expect(normalizeName('Agent 1')).toBe('agent1')
    expect(normalizeName('API Block')).toBe('apiblock')
    expect(normalizeName('My Custom Block')).toBe('mycustomblock')
  })

  it.concurrent('should normalize variable names correctly', () => {
    expect(normalizeName('jira1')).toBe('jira1')
    expect(normalizeName('JIRA TEAM UUID')).toBe('jirateamuuid')
    expect(normalizeName('My Variable')).toBe('myvariable')
  })

  it.concurrent('should produce consistent results for references', () => {
    const originalName = 'JIRA TEAM UUID'
    const normalized1 = normalizeName(originalName)
    const normalized2 = normalizeName(originalName)

    expect(normalized1).toBe(normalized2)
    expect(normalized1).toBe('jirateamuuid')
  })

  it.concurrent('should allow matching block references to variable references', () => {
    const name = 'API Block'
    const blockRef = `<${normalizeName(name)}.output>`
    const varRef = `<variable.${normalizeName(name)}>`

    expect(blockRef).toBe('<apiblock.output>')
    expect(varRef).toBe('<variable.apiblock>')
  })

  it.concurrent('should handle real-world naming patterns consistently', () => {
    const realWorldNames = [
      { input: 'User ID', expected: 'userid' },
      { input: 'API Key', expected: 'apikey' },
      { input: 'OAuth Token', expected: 'oauthtoken' },
      { input: 'Database URL', expected: 'databaseurl' },
      { input: 'STRIPE SECRET KEY', expected: 'stripesecretkey' },
      { input: 'openai api key', expected: 'openaiapikey' },
      { input: 'Customer Name', expected: 'customername' },
      { input: 'Order Total', expected: 'ordertotal' },
    ]

    for (const { input, expected } of realWorldNames) {
      expect(normalizeName(input)).toBe(expected)
    }
  })
})
