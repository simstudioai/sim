import {
  createAgentBlock,
  createBlock,
  createFunctionBlock,
  createLoopBlock,
  createStarterBlock,
} from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { getUniqueBlockName, normalizeName } from './utils'

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

describe('getUniqueBlockName', () => {
  it('should return "Start" for starter blocks', () => {
    expect(getUniqueBlockName('Start', {})).toBe('Start')
    expect(getUniqueBlockName('Starter', {})).toBe('Start')
    expect(getUniqueBlockName('start', {})).toBe('Start')
  })

  it('should return name with number 1 when no existing blocks', () => {
    expect(getUniqueBlockName('Agent', {})).toBe('Agent 1')
    expect(getUniqueBlockName('Function', {})).toBe('Function 1')
    expect(getUniqueBlockName('Loop', {})).toBe('Loop 1')
  })

  it('should increment number when existing blocks have same base name', () => {
    const existingBlocks = {
      'block-1': createAgentBlock({ id: 'block-1', name: 'Agent 1' }),
    }

    expect(getUniqueBlockName('Agent', existingBlocks)).toBe('Agent 2')
  })

  it('should find highest number and increment', () => {
    const existingBlocks = {
      'block-1': createAgentBlock({ id: 'block-1', name: 'Agent 1' }),
      'block-2': createAgentBlock({ id: 'block-2', name: 'Agent 3' }),
      'block-3': createAgentBlock({ id: 'block-3', name: 'Agent 2' }),
    }

    expect(getUniqueBlockName('Agent', existingBlocks)).toBe('Agent 4')
  })

  it('should handle base name with existing number suffix', () => {
    const existingBlocks = {
      'block-1': createFunctionBlock({ id: 'block-1', name: 'Function 1' }),
      'block-2': createFunctionBlock({ id: 'block-2', name: 'Function 2' }),
    }

    expect(getUniqueBlockName('Function 1', existingBlocks)).toBe('Function 3')
    expect(getUniqueBlockName('Function 5', existingBlocks)).toBe('Function 3')
  })

  it('should be case insensitive when matching base names', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'API 1' }),
      'block-2': createBlock({ id: 'block-2', name: 'api 2' }),
    }

    expect(getUniqueBlockName('API', existingBlocks)).toBe('API 3')
    expect(getUniqueBlockName('api', existingBlocks)).toBe('api 3')
  })

  it('should handle different block types independently', () => {
    const existingBlocks = {
      'block-1': createAgentBlock({ id: 'block-1', name: 'Agent 1' }),
      'block-2': createFunctionBlock({ id: 'block-2', name: 'Function 1' }),
      'block-3': createLoopBlock({ id: 'block-3', name: 'Loop 1' }),
    }

    expect(getUniqueBlockName('Agent', existingBlocks)).toBe('Agent 2')
    expect(getUniqueBlockName('Function', existingBlocks)).toBe('Function 2')
    expect(getUniqueBlockName('Loop', existingBlocks)).toBe('Loop 2')
    expect(getUniqueBlockName('Router', existingBlocks)).toBe('Router 1')
  })

  it('should handle blocks without numbers as having number 0', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'Custom' }),
    }

    expect(getUniqueBlockName('Custom', existingBlocks)).toBe('Custom 1')
  })

  it('should handle multi-word base names', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'API Block 1' }),
      'block-2': createBlock({ id: 'block-2', name: 'API Block 2' }),
    }

    expect(getUniqueBlockName('API Block', existingBlocks)).toBe('API Block 3')
  })

  it('should handle starter blocks even with existing starters', () => {
    const existingBlocks = {
      'block-1': createStarterBlock({ id: 'block-1', name: 'Start' }),
    }

    expect(getUniqueBlockName('Start', existingBlocks)).toBe('Start')
    expect(getUniqueBlockName('Starter', existingBlocks)).toBe('Start')
  })

  it('should handle empty string base name', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: ' 1' }),
    }

    expect(getUniqueBlockName('', existingBlocks)).toBe(' 1')
  })

  it('should handle complex real-world scenarios', () => {
    const existingBlocks = {
      starter: createStarterBlock({ id: 'starter', name: 'Start' }),
      agent1: createAgentBlock({ id: 'agent1', name: 'Agent 1' }),
      agent2: createAgentBlock({ id: 'agent2', name: 'Agent 2' }),
      func1: createFunctionBlock({ id: 'func1', name: 'Function 1' }),
      loop1: createLoopBlock({ id: 'loop1', name: 'Loop 1' }),
    }

    expect(getUniqueBlockName('Agent', existingBlocks)).toBe('Agent 3')
    expect(getUniqueBlockName('Function', existingBlocks)).toBe('Function 2')
    expect(getUniqueBlockName('Start', existingBlocks)).toBe('Start')
    expect(getUniqueBlockName('Condition', existingBlocks)).toBe('Condition 1')
  })

  it('should preserve original base name casing in result', () => {
    const existingBlocks = {
      'block-1': createBlock({ id: 'block-1', name: 'MyBlock 1' }),
    }

    expect(getUniqueBlockName('MyBlock', existingBlocks)).toBe('MyBlock 2')
    expect(getUniqueBlockName('MYBLOCK', existingBlocks)).toBe('MYBLOCK 2')
    expect(getUniqueBlockName('myblock', existingBlocks)).toBe('myblock 2')
  })
})
