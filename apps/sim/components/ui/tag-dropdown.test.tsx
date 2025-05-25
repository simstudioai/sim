import { describe, expect, test, vi } from 'vitest'
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
