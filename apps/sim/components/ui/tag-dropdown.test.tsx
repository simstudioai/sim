import { describe, expect, test, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks } from '@/stores/workflows/workflow/utils'
import { checkTagTrigger, extractFieldsFromSchema } from './tag-dropdown'

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
      'block.response.data',
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
      'block.response.data',
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
    expect(blockTags).toEqual(['block.response.data'])
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
  test('should extract fields from legacy format with fields array', () => {
    const responseFormat = {
      fields: [
        { name: 'name', type: 'string', description: 'User name' },
        { name: 'age', type: 'number', description: 'User age' },
      ],
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
    ])
  })

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
})

describe('TagDropdown Tag Ordering', () => {
  test('should create ordered tags array in correct sequence', () => {
    const variableTags = ['variable.userName', 'variable.userAge']
    const loopTags = ['loop.index', 'loop.currentItem']
    const parallelTags = ['parallel.index']
    const blockTags = ['block.response.data']

    const orderedTags = [...variableTags, ...loopTags, ...parallelTags, ...blockTags]

    expect(orderedTags).toEqual([
      'variable.userName',
      'variable.userAge',
      'loop.index',
      'loop.currentItem',
      'parallel.index',
      'block.response.data',
    ])
  })

  test('should create tag index map correctly', () => {
    const orderedTags = ['variable.userName', 'loop.index', 'block.response.data']

    const tagIndexMap = new Map<string, number>()
    orderedTags.forEach((tag, index) => {
      tagIndexMap.set(tag, index)
    })

    expect(tagIndexMap.get('variable.userName')).toBe(0)
    expect(tagIndexMap.get('loop.index')).toBe(1)
    expect(tagIndexMap.get('block.response.data')).toBe(2)
    expect(tagIndexMap.get('nonexistent')).toBeUndefined()
  })
})
