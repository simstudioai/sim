import { describe, expect, it } from 'vitest'
import { normalizeBlockName, normalizeName, normalizeVariableName } from './utils'

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
})

describe('normalizeBlockName', () => {
  it.concurrent('should be the same function as normalizeName', () => {
    expect(normalizeBlockName).toBe(normalizeName)
  })

  it.concurrent('should normalize block names correctly', () => {
    expect(normalizeBlockName('Agent 1')).toBe('agent1')
    expect(normalizeBlockName('API Block')).toBe('apiblock')
    expect(normalizeBlockName('My Custom Block')).toBe('mycustomblock')
  })
})

describe('normalizeVariableName', () => {
  it.concurrent('should be the same function as normalizeName', () => {
    expect(normalizeVariableName).toBe(normalizeName)
  })

  it.concurrent('should normalize variable names correctly', () => {
    expect(normalizeVariableName('jira1')).toBe('jira1')
    expect(normalizeVariableName('JIRA TEAM UUID')).toBe('jirateamuuid')
    expect(normalizeVariableName('My Variable')).toBe('myvariable')
  })

  it.concurrent('should produce consistent results for variable references', () => {
    const originalName = 'JIRA TEAM UUID'
    const normalizedForReference = normalizeVariableName(originalName)
    const normalizedForResolution = normalizeVariableName(originalName)

    expect(normalizedForReference).toBe(normalizedForResolution)
    expect(normalizedForReference).toBe('jirateamuuid')
  })
})

describe('block and variable normalization consistency', () => {
  it.concurrent('should normalize blocks and variables identically', () => {
    const testCases = [
      'Simple',
      'Two Words',
      'UPPERCASE NAME',
      'MixedCase Name',
      'with   multiple   spaces',
      'API 1',
      'Agent Block',
      'My Custom Thing',
      'JIRA TEAM UUID',
      'lowercase',
      '',
      '   ',
      'special-chars_here.too',
    ]

    for (const testCase of testCases) {
      expect(normalizeBlockName(testCase)).toBe(normalizeVariableName(testCase))
    }
  })

  it.concurrent('should allow matching block references to variable references', () => {
    const name = 'API Block'
    const blockRef = `<${normalizeBlockName(name)}.output>`
    const varRef = `<variable.${normalizeVariableName(name)}>`

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
      expect(normalizeBlockName(input)).toBe(expected)
      expect(normalizeVariableName(input)).toBe(expected)
      expect(normalizeName(input)).toBe(expected)
    }
  })
})
