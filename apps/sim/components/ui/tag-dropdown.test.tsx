import { describe, expect, test, vi } from 'vitest'
import { checkTagTrigger } from '@/components/ui/tag-dropdown'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks } from '@/stores/workflows/workflow/utils'

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: vi.fn(() => ({
    blocks: {},
    edges: [],
  })),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: vi.fn(() => ({
    activeWorkflowId: 'test-workflow',
  })),
}))

vi.mock('@/stores/panel/variables/store', () => ({
  useVariablesStore: vi.fn(() => ({
    getVariablesByWorkflowId: vi.fn(() => []),
    loadVariables: vi.fn(),
    variables: {},
  })),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: vi.fn(() => ({
    getValue: vi.fn(() => null),
    getState: vi.fn(() => ({
      getValue: vi.fn(() => null),
    })),
  })),
}))

describe('TagDropdown Loop Suggestions', () => {
  test('should generate correct loop suggestions for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          collection: '["item1", "item2", "item3"]',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'loop1',
        },
      },
    }

    const loops = generateLoopBlocks(blocks)

    // Verify loop was generated correctly
    expect(loops.loop1).toBeDefined()
    expect(loops.loop1.loopType).toBe('forEach')
    expect(loops.loop1.forEachItems).toEqual(['item1', 'item2', 'item3'])
    expect(loops.loop1.nodes).toContain('function1')

    // Simulate the tag generation logic from TagDropdown
    const loopTags: string[] = []
    const containingLoop = Object.entries(loops).find(([_, loop]) =>
      loop.nodes.includes('function1')
    )

    if (containingLoop) {
      const [_loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'

      // Add loop.index for all loop types
      loopTags.push('loop.index')

      // Add forEach specific properties
      if (loopType === 'forEach') {
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

    // Verify all loop tags are present
    expect(loopTags).toContain('loop.index')
    expect(loopTags).toContain('loop.currentItem')
    expect(loopTags).toContain('loop.items')
    expect(loopTags).toHaveLength(3)
  })

  test('should only generate loop.index for regular for loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'for',
          count: 5,
          collection: '',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'loop1',
        },
      },
    }

    const loops = generateLoopBlocks(blocks)

    // Simulate the tag generation logic
    const loopTags: string[] = []
    const containingLoop = Object.entries(loops).find(([_, loop]) =>
      loop.nodes.includes('function1')
    )

    if (containingLoop) {
      const [_loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'

      loopTags.push('loop.index')

      if (loopType === 'forEach') {
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

    // For regular loops, should only have loop.index
    expect(loopTags).toContain('loop.index')
    expect(loopTags).not.toContain('loop.currentItem')
    expect(loopTags).not.toContain('loop.items')
    expect(loopTags).toHaveLength(1)
  })
})

describe('TagDropdown Parallel Suggestions', () => {
  test('should generate correct parallel suggestions', () => {
    const blocks: Record<string, BlockState> = {
      parallel1: {
        id: 'parallel1',
        type: 'parallel',
        name: 'Test Parallel',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          collection: '["item1", "item2", "item3"]',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'parallel1',
        },
      },
    }

    // Simulate parallel blocks structure (similar to loops)
    const parallels = {
      parallel1: {
        nodes: ['function1'],
        collection: '["item1", "item2", "item3"]',
      },
    }

    // Simulate the tag generation logic for parallel blocks
    const parallelTags: string[] = []
    const containingParallel = Object.entries(parallels).find(([_, parallel]) =>
      parallel.nodes.includes('function1')
    )

    if (containingParallel) {
      // Add parallel.index for all parallel blocks
      parallelTags.push('parallel.index')
      // Add parallel.currentItem and parallel.items
      parallelTags.push('parallel.currentItem')
      parallelTags.push('parallel.items')
    }

    // Verify all parallel tags are present
    expect(parallelTags).toContain('parallel.index')
    expect(parallelTags).toContain('parallel.currentItem')
    expect(parallelTags).toContain('parallel.items')
    expect(parallelTags).toHaveLength(3)
  })
})

describe('TagDropdown Variable Suggestions', () => {
  test('should generate variable tags with correct format', () => {
    const variables = [
      { id: 'var1', name: 'User Name', type: 'string' },
      { id: 'var2', name: 'User Age', type: 'number' },
      { id: 'var3', name: 'Is Active', type: 'boolean' },
    ]

    // Simulate variable tag generation
    const variableTags = variables.map(
      (variable) => `variable.${variable.name.replace(/\s+/g, '')}`
    )

    expect(variableTags).toEqual(['variable.UserName', 'variable.UserAge', 'variable.IsActive'])
  })

  test('should create variable info map correctly', () => {
    const variables = [
      { id: 'var1', name: 'User Name', type: 'string' },
      { id: 'var2', name: 'User Age', type: 'number' },
    ]

    // Simulate variable info map creation
    const variableInfoMap = variables.reduce(
      (acc, variable) => {
        const tagName = `variable.${variable.name.replace(/\s+/g, '')}`
        acc[tagName] = {
          type: variable.type,
          id: variable.id,
        }
        return acc
      },
      {} as Record<string, { type: string; id: string }>
    )

    expect(variableInfoMap).toEqual({
      'variable.UserName': { type: 'string', id: 'var1' },
      'variable.UserAge': { type: 'number', id: 'var2' },
    })
  })
})

describe('TagDropdown Search and Filtering', () => {
  test('should extract search term from input correctly', () => {
    const testCases = [
      { input: 'Hello <var', cursorPosition: 10, expected: 'var' },
      { input: 'Hello <Variable.', cursorPosition: 16, expected: 'variable.' },
      { input: 'Hello <loop.in', cursorPosition: 14, expected: 'loop.in' },
      { input: 'Hello world', cursorPosition: 11, expected: '' },
      { input: 'Hello <var> and <loo', cursorPosition: 20, expected: 'loo' },
    ]

    testCases.forEach(({ input, cursorPosition, expected }) => {
      const textBeforeCursor = input.slice(0, cursorPosition)
      const match = textBeforeCursor.match(/<([^>]*)$/)
      const searchTerm = match ? match[1].toLowerCase() : ''

      expect(searchTerm).toBe(expected)
    })
  })

  test('should filter tags based on search term', () => {
    const tags = [
      'variable.userName',
      'variable.userAge',
      'loop.index',
      'loop.currentItem',
      'parallel.index',
      'block.data',
    ]

    const searchTerm = 'user'
    const filteredTags = tags.filter((tag) => tag.toLowerCase().includes(searchTerm))

    expect(filteredTags).toEqual(['variable.userName', 'variable.userAge'])
  })

  test('should group tags correctly by type', () => {
    const tags = [
      'variable.userName',
      'loop.index',
      'parallel.currentItem',
      'block.data',
      'variable.userAge',
      'loop.currentItem',
    ]

    const variableTags: string[] = []
    const loopTags: string[] = []
    const parallelTags: string[] = []
    const blockTags: string[] = []

    tags.forEach((tag) => {
      if (tag.startsWith('variable.')) {
        variableTags.push(tag)
      } else if (tag.startsWith('loop.')) {
        loopTags.push(tag)
      } else if (tag.startsWith('parallel.')) {
        parallelTags.push(tag)
      } else {
        blockTags.push(tag)
      }
    })

    expect(variableTags).toEqual(['variable.userName', 'variable.userAge'])
    expect(loopTags).toEqual(['loop.index', 'loop.currentItem'])
    expect(parallelTags).toEqual(['parallel.currentItem'])
    expect(blockTags).toEqual(['block.data'])
  })
})

describe('checkTagTrigger helper function', () => {
  test('should return true when there is an unclosed < bracket', () => {
    const testCases = [
      { text: 'Hello <', cursorPosition: 7, expected: true },
      { text: 'Hello <var', cursorPosition: 10, expected: true },
      { text: 'Hello <variable.', cursorPosition: 16, expected: true },
    ]

    testCases.forEach(({ text, cursorPosition, expected }) => {
      const result = checkTagTrigger(text, cursorPosition)
      expect(result.show).toBe(expected)
    })
  })

  test('should return false when there is no unclosed < bracket', () => {
    const testCases = [
      { text: 'Hello world', cursorPosition: 11, expected: false },
      { text: 'Hello <var>', cursorPosition: 11, expected: false },
      { text: 'Hello <var> and more', cursorPosition: 20, expected: false },
      { text: '', cursorPosition: 0, expected: false },
    ]

    testCases.forEach(({ text, cursorPosition, expected }) => {
      const result = checkTagTrigger(text, cursorPosition)
      expect(result.show).toBe(expected)
    })
  })

  test('should handle edge cases correctly', () => {
    // Cursor at position 0
    expect(checkTagTrigger('Hello', 0).show).toBe(false)

    // Multiple brackets with unclosed one at the end
    expect(checkTagTrigger('Hello <var> and <loo', 20).show).toBe(true)

    // Multiple brackets all closed
    expect(checkTagTrigger('Hello <var> and <loop>', 22).show).toBe(false)
  })
})

describe('extractFieldsFromSchema helper function logic', () => {
  test('should extract fields from JSON Schema format', () => {
    const responseFormat = {
      schema: {
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number', description: 'User age' },
          tags: { type: 'array', description: 'User tags' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
      { name: 'tags', type: 'array', description: 'User tags' },
    ])
  })

  test('should handle direct schema format', () => {
    const responseFormat = {
      properties: {
        status: { type: 'boolean', description: 'Status flag' },
        data: { type: 'object', description: 'Response data' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'status', type: 'boolean', description: 'Status flag' },
      { name: 'data', type: 'object', description: 'Response data' },
    ])
  })

  test('should return empty array for invalid or missing schema', () => {
    expect(extractFieldsFromSchema(null)).toEqual([])
    expect(extractFieldsFromSchema(undefined)).toEqual([])
    expect(extractFieldsFromSchema({})).toEqual([])
    expect(extractFieldsFromSchema({ schema: null })).toEqual([])
    expect(extractFieldsFromSchema({ schema: { properties: null } })).toEqual([])
    expect(extractFieldsFromSchema('invalid')).toEqual([])
  })

  test('should handle array properties correctly', () => {
    const responseFormat = {
      properties: {
        items: ['string', 'array'],
        name: { type: 'string' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'items', type: 'array', description: undefined },
      { name: 'name', type: 'string', description: undefined },
    ])
  })

  test('should default to string type when type is missing', () => {
    const responseFormat = {
      properties: {
        name: { description: 'User name' },
        age: { type: 'number' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: undefined },
    ])
  })

  test('should handle flattened response format (new format)', () => {
    const responseFormat = {
      schema: {
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number', description: 'User age' },
          status: { type: 'boolean', description: 'Active status' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
      { name: 'status', type: 'boolean', description: 'Active status' },
    ])
  })
})

describe('TagDropdown Tag Ordering', () => {
  test('should create ordered tags array in correct sequence', () => {
    const variableTags = ['variable.userName', 'variable.userAge']
    const loopTags = ['loop.index', 'loop.currentItem']
    const parallelTags = ['parallel.index']
    const blockTags = ['block.data']

    const orderedTags = [...variableTags, ...loopTags, ...parallelTags, ...blockTags]

    expect(orderedTags).toEqual([
      'variable.userName',
      'variable.userAge',
      'loop.index',
      'loop.currentItem',
      'parallel.index',
      'block.data',
    ])
  })

  test('should create tag index map correctly', () => {
    const orderedTags = ['variable.userName', 'loop.index', 'block.data']

    const tagIndexMap = new Map<string, number>()
    orderedTags.forEach((tag, index) => {
      tagIndexMap.set(tag, index)
    })

    expect(tagIndexMap.get('variable.userName')).toBe(0)
    expect(tagIndexMap.get('loop.index')).toBe(1)
    expect(tagIndexMap.get('block.data')).toBe(2)
    expect(tagIndexMap.get('nonexistent')).toBeUndefined()
  })
})

describe('TagDropdown Tag Selection Logic', () => {
  test('should handle existing closing bracket correctly when editing tags', () => {
    const testCases = [
      {
        description: 'should remove existing closing bracket from incomplete tag',
        inputValue: 'Hello <start.>',
        cursorPosition: 13, // cursor after the dot
        tag: 'start.input',
        expectedResult: 'Hello <start.input>',
      },
      {
        description: 'should remove existing closing bracket when replacing tag content',
        inputValue: 'Hello <start.input>',
        cursorPosition: 12, // cursor after 'start.'
        tag: 'start.data',
        expectedResult: 'Hello <start.data>',
      },
      {
        description: 'should preserve content after closing bracket',
        inputValue: 'Hello <start.> world',
        cursorPosition: 13,
        tag: 'start.input',
        expectedResult: 'Hello <start.input> world',
      },
      {
        description:
          'should not affect closing bracket if text between contains invalid characters',
        inputValue: 'Hello <start.input> and <other>',
        cursorPosition: 12,
        tag: 'start.data',
        expectedResult: 'Hello <start.data> and <other>',
      },
      {
        description: 'should handle case with no existing closing bracket',
        inputValue: 'Hello <start',
        cursorPosition: 12,
        tag: 'start.input',
        expectedResult: 'Hello <start.input>',
      },
    ]

    testCases.forEach(({ description, inputValue, cursorPosition, tag, expectedResult }) => {
      // Simulate the handleTagSelect logic
      const textBeforeCursor = inputValue.slice(0, cursorPosition)
      const textAfterCursor = inputValue.slice(cursorPosition)
      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

      // Apply the new logic for handling existing closing brackets
      const nextCloseBracket = textAfterCursor.indexOf('>')
      let remainingTextAfterCursor = textAfterCursor

      if (nextCloseBracket !== -1) {
        const textBetween = textAfterCursor.slice(0, nextCloseBracket)
        if (/^[a-zA-Z0-9._]*$/.test(textBetween)) {
          remainingTextAfterCursor = textAfterCursor.slice(nextCloseBracket + 1)
        }
      }

      const newValue = `${textBeforeCursor.slice(0, lastOpenBracket)}<${tag}>${remainingTextAfterCursor}`

      expect(newValue).toBe(expectedResult)
    })
  })

  test('should validate tag-like character regex correctly', () => {
    const regex = /^[a-zA-Z0-9._]*$/

    // Valid tag-like text
    expect(regex.test('')).toBe(true) // empty string
    expect(regex.test('input')).toBe(true)
    expect(regex.test('content.data')).toBe(true)
    expect(regex.test('user_name')).toBe(true)
    expect(regex.test('item123')).toBe(true)
    expect(regex.test('content.data.item_1')).toBe(true)

    // Invalid tag-like text (should not remove closing bracket)
    expect(regex.test('input> and more')).toBe(false)
    expect(regex.test('content data')).toBe(false) // space
    expect(regex.test('user-name')).toBe(false) // hyphen
    expect(regex.test('data[')).toBe(false) // bracket
    expect(regex.test('content.data!')).toBe(false) // exclamation
  })

  test('should find correct position of last open bracket', () => {
    const testCases = [
      { input: 'Hello <start', expected: 6 },
      { input: 'Hello <var> and <start', expected: 16 },
      { input: 'No brackets here', expected: -1 },
      { input: '<start', expected: 0 },
      { input: 'Multiple < < < <last', expected: 15 },
    ]

    testCases.forEach(({ input, expected }) => {
      const lastOpenBracket = input.lastIndexOf('<')
      expect(lastOpenBracket).toBe(expected)
    })
  })

  test('should find correct position of next closing bracket', () => {
    const testCases = [
      { input: 'input>', expected: 5 },
      { input: 'content.data> more text', expected: 12 },
      { input: 'no closing bracket', expected: -1 },
      { input: '>', expected: 0 },
      { input: 'multiple > > > >last', expected: 9 },
    ]

    testCases.forEach(({ input, expected }) => {
      const nextCloseBracket = input.indexOf('>')
      expect(nextCloseBracket).toBe(expected)
    })
  })
})

describe('TagDropdown Response Format Support', () => {
  it.concurrent(
    'should use custom schema properties when response format is specified',
    async () => {
      // Mock the subblock store to return a custom response format
      const mockGetValue = vi.fn()
      const mockUseSubBlockStore = vi.mocked(
        await import('@/stores/workflows/subblock/store')
      ).useSubBlockStore

      // Set up the mock to return the example schema from the user
      const responseFormatValue = JSON.stringify({
        name: 'short_schema',
        description: 'A minimal example schema with a single string property.',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            example_property: {
              type: 'string',
              description: 'A simple string property.',
            },
          },
          additionalProperties: false,
          required: ['example_property'],
        },
      })

      mockGetValue.mockImplementation((blockId: string, subBlockId: string) => {
        if (blockId === 'agent1' && subBlockId === 'responseFormat') {
          return responseFormatValue
        }
        return null
      })

      mockUseSubBlockStore.mockReturnValue({
        getValue: mockGetValue,
        getState: () => ({
          getValue: mockGetValue,
        }),
      } as any)

      // Test the parseResponseFormatSafely function
      const parsedFormat = parseResponseFormatSafely(responseFormatValue, 'agent1')

      expect(parsedFormat).toEqual({
        name: 'short_schema',
        description: 'A minimal example schema with a single string property.',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            example_property: {
              type: 'string',
              description: 'A simple string property.',
            },
          },
          additionalProperties: false,
          required: ['example_property'],
        },
      })

      // Test the extractFieldsFromSchema function with the parsed format
      const fields = extractFieldsFromSchema(parsedFormat)

      expect(fields).toEqual([
        {
          name: 'example_property',
          type: 'string',
          description: 'A simple string property.',
        },
      ])
    }
  )

  it.concurrent(
    'should fallback to default outputs when response format parsing fails',
    async () => {
      // Test with invalid JSON
      const invalidFormat = parseResponseFormatSafely('invalid json', 'agent1')
      expect(invalidFormat).toBeNull()

      // Test with null/undefined values
      expect(parseResponseFormatSafely(null, 'agent1')).toBeNull()
      expect(parseResponseFormatSafely(undefined, 'agent1')).toBeNull()
      expect(parseResponseFormatSafely('', 'agent1')).toBeNull()
    }
  )

  it.concurrent('should handle response format with nested schema correctly', async () => {
    const responseFormat = {
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            description: 'User information',
            properties: {
              name: { type: 'string', description: 'User name' },
              age: { type: 'number', description: 'User age' },
            },
          },
          status: { type: 'string', description: 'Response status' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'user', type: 'object', description: 'User information' },
      { name: 'status', type: 'string', description: 'Response status' },
    ])
  })

  it.concurrent('should handle response format without schema wrapper', async () => {
    const responseFormat = {
      type: 'object',
      properties: {
        result: { type: 'boolean', description: 'Operation result' },
        message: { type: 'string', description: 'Status message' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'result', type: 'boolean', description: 'Operation result' },
      { name: 'message', type: 'string', description: 'Status message' },
    ])
  })

  it.concurrent('should return object as-is when it is already parsed', async () => {
    const responseFormat = {
      name: 'test_schema',
      schema: {
        properties: {
          data: { type: 'string' },
        },
      },
    }

    const result = parseResponseFormatSafely(responseFormat, 'agent1')

    expect(result).toEqual(responseFormat)
  })

  it.concurrent('should simulate block tag generation with custom response format', async () => {
    // Simulate the tag generation logic that would happen in the component
    const blockName = 'Agent 1'
    const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase() // 'agent1'

    // Mock response format
    const responseFormat = {
      schema: {
        properties: {
          example_property: { type: 'string', description: 'A simple string property.' },
          another_field: { type: 'number', description: 'Another field.' },
        },
      },
    }

    const schemaFields = extractFieldsFromSchema(responseFormat)

    // Generate block tags as they would be in the component
    const blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)

    expect(blockTags).toEqual(['agent1.example_property', 'agent1.another_field'])

    // Verify the fields extracted correctly
    expect(schemaFields).toEqual([
      { name: 'example_property', type: 'string', description: 'A simple string property.' },
      { name: 'another_field', type: 'number', description: 'Another field.' },
    ])
  })
})
