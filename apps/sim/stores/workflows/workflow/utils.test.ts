import { createAgentBlock, createLoopBlock } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  convertLoopBlockToLoop,
  isAncestorProtected,
  isBlockProtected,
} from '@/stores/workflows/workflow/utils'

describe('convertLoopBlockToLoop', () => {
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
