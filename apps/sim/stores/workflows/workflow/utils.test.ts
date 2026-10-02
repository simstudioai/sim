import { createAgentBlock, createLoopBlock } from '@sim/testing'
import {
  isWorkflowBlockAncestorLocked,
  isWorkflowBlockProtected,
} from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'

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

    expect(isWorkflowBlockAncestorLocked('child', blocks)).toBe(true)
    expect(isWorkflowBlockProtected('child', blocks)).toBe(true)
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

      expect(isWorkflowBlockAncestorLocked('first', blocks)).toBe(false)
      expect(isWorkflowBlockProtected('first', blocks)).toBe(false)
    }
  )
})
