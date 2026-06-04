import { createAgentBlock, createLoopBlock } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  convertLoopBlockToLoop,
  isAncestorProtected,
  isBlockProtected,
} from '@/stores/workflows/workflow/utils'

describe('convertLoopBlockToLoop', () => {
  it.concurrent('should keep JSON array string as-is for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createLoopBlock({
        id: 'loop1',
        name: 'Test Loop',
        loopType: 'forEach',
        count: 10,
        data: { collection: '["item1", "item2", "item3"]' },
      }),
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toBe('["item1", "item2", "item3"]')
    expect(result?.iterations).toBe(10)
  })

  it.concurrent('should keep JSON object string as-is for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createLoopBlock({
        id: 'loop1',
        name: 'Test Loop',
        loopType: 'forEach',
        count: 5,
        data: { collection: '{"key1": "value1", "key2": "value2"}' },
      }),
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toBe('{"key1": "value1", "key2": "value2"}')
  })

  it.concurrent('should keep string as-is if not valid JSON', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createLoopBlock({
        id: 'loop1',
        name: 'Test Loop',
        loopType: 'forEach',
        count: 5,
        data: { collection: '<blockName.items>' },
      }),
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('<blockName.items>')
  })

  it.concurrent('should handle empty collection', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createLoopBlock({
        id: 'loop1',
        name: 'Test Loop',
        loopType: 'forEach',
        count: 5,
        data: { collection: '' },
      }),
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('')
  })

  it.concurrent('should handle for loops without collection parsing', () => {
    const blocks: Record<string, BlockState> = {
      loop1: createLoopBlock({
        id: 'loop1',
        name: 'Test Loop',
        loopType: 'for',
        count: 5,
        data: { collection: '["should", "not", "matter"]' },
      }),
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('for')
    expect(result?.iterations).toBe(5)
    expect(result?.forEachItems).toBe('["should", "not", "matter"]')
  })
})

describe('block lock protection', () => {
  it.concurrent('treats deeply nested blocks inside locked containers as protected', () => {
    const blocks: Record<string, BlockState> = {
      grandparent: createLoopBlock({
        id: 'grandparent',
        name: 'Grandparent Loop',
        locked: true,
      }),
      parent: createLoopBlock({
        id: 'parent',
        name: 'Parent Loop',
        parentId: 'grandparent',
      }),
      child: createAgentBlock({
        id: 'child',
        name: 'Child Agent',
        parentId: 'parent',
      }),
    }

    expect(isAncestorProtected('child', blocks)).toBe(true)
    expect(isBlockProtected('child', blocks)).toBe(true)
  })

  it.concurrent(
    'does not treat ancestor cycles as protected unless a locked ancestor is found',
    () => {
      const blocks: Record<string, BlockState> = {
        first: createAgentBlock({
          id: 'first',
          name: 'First Agent',
          parentId: 'second',
        }),
        second: createAgentBlock({
          id: 'second',
          name: 'Second Agent',
          parentId: 'first',
        }),
      }

      expect(isAncestorProtected('first', blocks)).toBe(false)
      expect(isBlockProtected('first', blocks)).toBe(false)
    }
  )
})
