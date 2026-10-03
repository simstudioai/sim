/**
 * Comprehensive tests for the workflow store.
 *
 * Tests cover:
 * - Block operations (add, remove, duplicate, update)
 * - Edge operations (add, remove, cycle prevention)
 * - Loop management (count, type, collection updates)
 * - Parallel management (count, type, collection updates)
 * - Mode switching (basic/advanced)
 * - Parent-child relationships
 * - Workflow state management
 */

import { createMockStorage, expectBlockNotExists, expectEdgeCount } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Helper function to add a single block using batchAddBlocks.
 * Provides a simpler interface for tests.
 */
function addBlock(
  id: string,
  type: string,
  name: string,
  position: { x: number; y: number },
  data?: Record<string, unknown>,
  parentId?: string,
  extent?: 'parent',
  blockProperties?: {
    enabled?: boolean
    horizontalHandles?: boolean
    advancedMode?: boolean
    triggerMode?: boolean
    height?: number
  }
) {
  const blockData = {
    ...data,
    ...(parentId && { parentId, extent: extent || 'parent' }),
  }

  useWorkflowStore.getState().batchAddBlocks([
    {
      id,
      type,
      name,
      position,
      subBlocks: {},
      outputs: {},
      enabled: blockProperties?.enabled ?? true,
      horizontalHandles: blockProperties?.horizontalHandles ?? true,
      advancedMode: blockProperties?.advancedMode ?? false,
      triggerMode: blockProperties?.triggerMode ?? false,
      height: blockProperties?.height ?? 0,
      data: blockData,
    },
  ])
}

describe('workflow store', () => {
  beforeEach(() => {
    const localStorageMock = createMockStorage()
    global.localStorage = localStorageMock as unknown as Storage

    useWorkflowStore.setState({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  describe('batchRemoveBlocks', () => {
    it('should remove connected edges when block is removed', () => {
      const { batchAddEdges, batchRemoveBlocks } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'Middle', { x: 200, y: 0 })
      addBlock('block-3', 'function', 'End', { x: 400, y: 0 })

      batchAddEdges([
        { id: 'e1', source: 'block-1', target: 'block-2' },
        { id: 'e2', source: 'block-2', target: 'block-3' },
      ])

      batchRemoveBlocks(['block-2'])

      const state = useWorkflowStore.getState()
      expectBlockNotExists(state.blocks, 'block-2')
      expectEdgeCount(state, 0)
    })
  })

  describe('batchAddEdges', () => {
    it('should not add duplicate connections', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])
      batchAddEdges([{ id: 'e2', source: 'block-1', target: 'block-2' }])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 1)
    })

    it('should not add duplicate connections that appear twice within the same batch', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      batchAddEdges([
        { id: 'e1', source: 'block-1', target: 'block-2' },
        { id: 'e2', source: 'block-1', target: 'block-2' },
      ])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 1)
      expect(state.edges.some((e) => e.id === 'e1')).toBe(true)
      expect(state.edges.some((e) => e.id === 'e2')).toBe(false)
    })

    it('should treat an empty-string handle as equivalent to no handle when deduping', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      batchAddEdges([
        { id: 'e1', source: 'block-1', target: 'block-2', sourceHandle: '' },
        { id: 'e2', source: 'block-1', target: 'block-2' },
      ])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 1)
      expect(state.edges.some((e) => e.id === 'e1')).toBe(true)
      expect(state.edges.some((e) => e.id === 'e2')).toBe(false)
    })

    it('should not add a self-loop edge', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })

      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-1' }])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 0)
    })

    it('should reject an edge that would create a cycle', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'Middle', { x: 200, y: 0 })
      addBlock('block-3', 'function', 'End', { x: 400, y: 0 })

      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])
      batchAddEdges([{ id: 'e2', source: 'block-2', target: 'block-3' }])
      // block-3 -> block-1 would close the loop back to block-1
      batchAddEdges([{ id: 'e3', source: 'block-3', target: 'block-1' }])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 2)
      expect(state.edges.some((e) => e.id === 'e3')).toBe(false)
    })

    it('should reject a cyclic edge within the same batch', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'Middle', { x: 200, y: 0 })
      addBlock('block-3', 'function', 'End', { x: 400, y: 0 })

      batchAddEdges([
        { id: 'e1', source: 'block-1', target: 'block-2' },
        { id: 'e2', source: 'block-2', target: 'block-3' },
        { id: 'e3', source: 'block-3', target: 'block-1' },
      ])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 2)
      expect(state.edges.some((e) => e.id === 'e3')).toBe(false)
    })
  })

  describe('duplicateBlock cloned webhook path', () => {
    /**
     * `duplicateBlock` is not currently reachable from the canvas (the context-menu Duplicate goes
     * through `preparePasteData` → `regenerateBlockIds`), but it is part of the store's public API,
     * so the clone it produces must not inherit the source's deployed webhook identity either.
     */
    it('clears triggerPath when duplicating a webhook trigger block', () => {
      const { duplicateBlock } = useWorkflowStore.getState()
      useWorkflowRegistry.setState({ activeWorkflowId: 'wf-1' })
      useWorkflowStore.setState({ currentWorkflowId: 'wf-1' })

      addBlock('original', 'generic_webhook', 'Webhook 1', { x: 0, y: 0 })
      useWorkflowStore.setState((state) => ({
        blocks: {
          ...state.blocks,
          original: {
            ...state.blocks.original,
            subBlocks: {
              triggerPath: { id: 'triggerPath', type: 'short-input', value: 'original' },
              webhookId: { id: 'webhookId', type: 'short-input', value: 'wh_original' },
            },
          },
        },
      }))
      useSubBlockStore.setState({
        workflowValues: {
          'wf-1': { original: { triggerPath: 'original', webhookId: 'wh_original' } },
        },
      })

      duplicateBlock('original')

      const { blocks } = useWorkflowStore.getState()
      const duplicatedId = Object.keys(blocks).find((id) => id !== 'original')
      expect(duplicatedId).toBeDefined()
      if (!duplicatedId) return

      // Both sources must be cleared: the value map overrides the structure in mergeSubblockState.
      expect(blocks[duplicatedId].subBlocks.triggerPath?.value).toBeNull()
      const values = useSubBlockStore.getState().workflowValues['wf-1']
      expect(values[duplicatedId].triggerPath).toBeNull()
      // webhookId is user-entered action config on some blocks and is deliberately preserved.
      expect(values[duplicatedId].webhookId).toBe('wh_original')
      // The source keeps its own identity.
      expect(values.original.triggerPath).toBe('original')
    })

    it('preserves a user-entered webhookId when duplicating an action block', () => {
      const { duplicateBlock } = useWorkflowStore.getState()
      useWorkflowRegistry.setState({ activeWorkflowId: 'wf-1' })
      useWorkflowStore.setState({ currentWorkflowId: 'wf-1' })

      addBlock('original', 'discord', 'Discord 1', { x: 0, y: 0 })
      useSubBlockStore.setState({
        workflowValues: { 'wf-1': { original: { webhookId: '1234567890' } } },
      })

      duplicateBlock('original')

      const { blocks } = useWorkflowStore.getState()
      const duplicatedId = Object.keys(blocks).find((id) => id !== 'original')
      expect(duplicatedId).toBeDefined()
      if (!duplicatedId) return

      const values = useSubBlockStore.getState().workflowValues['wf-1']
      expect(values[duplicatedId].webhookId).toBe('1234567890')
    })
  })

  describe('loop management', () => {
    it('should regenerate loops when updateLoopCount is called', () => {
      const { updateLoopCount } = useWorkflowStore.getState()

      addBlock(
        'loop1',
        'loop',
        'Test Loop',
        { x: 0, y: 0 },
        {
          loopType: 'for',
          count: 5,
          collection: '',
        }
      )

      updateLoopCount('loop1', 10)

      const state = useWorkflowStore.getState()

      expect(state.blocks.loop1?.data?.count).toBe(10)
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.iterations).toBe(10)
    })

    it('should allow loop counts above 1000 and clamp only to at least 1', () => {
      const { updateLoopCount } = useWorkflowStore.getState()

      addBlock(
        'loop1',
        'loop',
        'Test Loop',
        { x: 0, y: 0 },
        {
          loopType: 'for',
          count: 5,
          collection: '',
        }
      )

      updateLoopCount('loop1', 1500)
      let state = useWorkflowStore.getState()
      expect(state.blocks.loop1?.data?.count).toBe(1500)

      updateLoopCount('loop1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.loop1?.data?.count).toBe(1)
    })
  })

  describe('parallel management', () => {
    it('should regenerate parallels when updateParallelCount is called', () => {
      const { updateParallelCount } = useWorkflowStore.getState()

      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        {
          count: 3,
          collection: '',
        }
      )

      updateParallelCount('parallel1', 5)

      const state = useWorkflowStore.getState()

      expect(state.blocks.parallel1?.data?.count).toBe(5)
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.distribution).toBeUndefined()
    })

    it('should allow parallel counts above 1000 and clamp only to at least 1', () => {
      const { updateParallelCount } = useWorkflowStore.getState()

      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        {
          count: 5,
          collection: '',
        }
      )

      updateParallelCount('parallel1', 100)
      let state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(100)

      updateParallelCount('parallel1', 1001)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(1001)

      updateParallelCount('parallel1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(1)
    })

    it('should clamp parallel batch size between 1 and 20', () => {
      const { updateParallelBatchSize } = useWorkflowStore.getState()

      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        {
          count: 5,
          batchSize: 20,
          collection: '',
        }
      )

      updateParallelBatchSize('parallel1', 7)
      let state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.batchSize).toBe(7)
      expect(state.parallels.parallel1.batchSize).toBe(7)

      updateParallelBatchSize('parallel1', 50)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.batchSize).toBe(20)

      updateParallelBatchSize('parallel1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.batchSize).toBe(1)
    })
  })

  describe('mode switching', () => {
    it('should preserve systemPrompt and userPrompt when switching modes', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()
      const { setState: setSubBlockState } = useSubBlockStore
      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })
      setSubBlockState({
        workflowValues: {
          'test-workflow': {
            agent1: {
              systemPrompt: 'You are a helpful assistant',
              userPrompt: 'Hello, how are you?',
            },
          },
        },
      })
      toggleBlockAdvancedMode('agent1')
      let subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'Hello, how are you?'
      )
      toggleBlockAdvancedMode('agent1')
      subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'Hello, how are you?'
      )
    })

    it('should preserve memories when switching from advanced to basic mode', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()
      const { setState: setSubBlockState } = useSubBlockStore

      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })

      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      toggleBlockAdvancedMode('agent1')

      setSubBlockState({
        workflowValues: {
          'test-workflow': {
            agent1: {
              systemPrompt: 'You are a helpful assistant',
              userPrompt: 'What did we discuss?',
              memories: [
                { role: 'user', content: 'My name is John' },
                { role: 'assistant', content: 'Nice to meet you, John!' },
              ],
            },
          },
        },
      })

      toggleBlockAdvancedMode('agent1')

      const subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'What did we discuss?'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.memories).toEqual([
        { role: 'user', content: 'My name is John' },
        { role: 'assistant', content: 'Nice to meet you, John!' },
      ])
    })
  })

  describe('setBlockCanonicalMode / setBlockCanonicalModes', () => {
    it('should merge without clobbering existing keys', () => {
      const { setBlockCanonicalMode } = useWorkflowStore.getState()
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      setBlockCanonicalMode('agent1', '0:tableId', 'advanced')
      setBlockCanonicalMode('agent1', '1:tableId', 'basic')

      expect(useWorkflowStore.getState().blocks.agent1?.data?.canonicalModes).toEqual({
        '0:tableId': 'advanced',
        '1:tableId': 'basic',
      })
    })

    it('should wholesale-replace canonicalModes, dropping keys absent from the new map', () => {
      const { setBlockCanonicalMode, setBlockCanonicalModes } = useWorkflowStore.getState()
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })
      setBlockCanonicalMode('agent1', '0:tableId', 'advanced')
      setBlockCanonicalMode('agent1', '1:tableId', 'basic')

      // Reindex after removing tool 0: only tool 1's (now re-keyed) entry survives.
      setBlockCanonicalModes('agent1', { '0:tableId': 'basic' })

      expect(useWorkflowStore.getState().blocks.agent1?.data?.canonicalModes).toEqual({
        '0:tableId': 'basic',
      })
    })

    it('should preserve sibling data fields when replacing canonicalModes', () => {
      const { setBlockCanonicalMode, setBlockCanonicalModes } = useWorkflowStore.getState()
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })
      setBlockCanonicalMode('agent1', '0:tableId', 'advanced')
      useWorkflowStore.setState((state) => ({
        blocks: {
          ...state.blocks,
          agent1: {
            ...state.blocks.agent1,
            data: { ...state.blocks.agent1.data, someOtherField: 'keep-me' },
          },
        },
      }))

      setBlockCanonicalModes('agent1', {})

      const data = useWorkflowStore.getState().blocks.agent1?.data
      expect(data?.canonicalModes).toEqual({})
      expect(data?.someOtherField).toBe('keep-me')
    })
  })

  describe('syncDynamicHandleSubblockValue', () => {
    it('should sync condition topology values into the workflow store', () => {
      addBlock('condition-1', 'condition', 'Condition 1', { x: 0, y: 0 })

      useWorkflowStore.getState().syncDynamicHandleSubblockValue(
        'condition-1',
        'conditions',
        JSON.stringify([
          { id: 'condition-1-if', title: 'if', value: 'true' },
          { id: 'condition-1-else', title: 'else', value: '' },
        ])
      )

      const conditionBlock = useWorkflowStore.getState().blocks['condition-1']
      expect(conditionBlock.subBlocks.conditions?.type).toBe('condition-input')
      expect(conditionBlock.subBlocks.conditions?.value).toBe(
        JSON.stringify([
          { id: 'condition-1-if', title: 'if', value: 'true' },
          { id: 'condition-1-else', title: 'else', value: '' },
        ])
      )
    })
  })

  describe('loop/parallel regeneration optimization', () => {
    it('should regenerate loops when adding a child to a loop', () => {
      // Add a loop
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })

      const stateAfterLoop = useWorkflowStore.getState()
      expect(stateAfterLoop.loops['loop-1'].nodes).toEqual([])

      // Add a child block to the loop
      addBlock(
        'child-1',
        'function',
        'Child 1',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )

      const stateAfterChild = useWorkflowStore.getState()

      // Loop should now include the child
      expect(stateAfterChild.loops['loop-1'].nodes).toContain('child-1')
    })

    it('should regenerate parallels when adding a child to a parallel', () => {
      // Add a parallel
      addBlock('parallel-1', 'parallel', 'Parallel 1', { x: 0, y: 0 }, { count: 3 })

      const stateAfterParallel = useWorkflowStore.getState()
      expect(stateAfterParallel.parallels['parallel-1'].nodes).toEqual([])

      // Add a child block to the parallel
      addBlock(
        'child-1',
        'function',
        'Child 1',
        { x: 50, y: 50 },
        { parentId: 'parallel-1' },
        'parallel-1',
        'parent'
      )

      const stateAfterChild = useWorkflowStore.getState()

      // Parallel should now include the child
      expect(stateAfterChild.parallels['parallel-1'].nodes).toContain('child-1')
    })

    it('should handle adding blocks in any order and produce correct final state', () => {
      // Add child BEFORE the loop (simulating undo-redo edge case)
      // Note: The child's parentId points to a loop that doesn't exist yet
      addBlock(
        'child-1',
        'function',
        'Child 1',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )

      // At this point, the child exists but loop doesn't
      const stateAfterChild = useWorkflowStore.getState()
      expect(stateAfterChild.blocks['child-1']).toBeDefined()
      expect(stateAfterChild.loops['loop-1']).toBeUndefined()

      // Now add the loop
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })

      // Final state should be correct - loop should include the child
      const finalState = useWorkflowStore.getState()
      expect(finalState.loops['loop-1']).toBeDefined()
      expect(finalState.loops['loop-1'].nodes).toContain('child-1')
    })
  })

  describe('batchAddBlocks optimization', () => {
    it('should regenerate loops when batch adding a child of a loop', () => {
      const { batchAddBlocks } = useWorkflowStore.getState()

      // First add a loop
      batchAddBlocks([
        {
          id: 'loop-1',
          type: 'loop',
          name: 'Loop 1',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { loopType: 'for', count: 5 },
        },
      ])

      // Then add a child
      batchAddBlocks([
        {
          id: 'child-1',
          type: 'function',
          name: 'Child 1',
          position: { x: 50, y: 50 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { parentId: 'loop-1' },
        },
      ])

      const state = useWorkflowStore.getState()
      expect(state.loops['loop-1'].nodes).toContain('child-1')
    })

    it('should correctly handle batch adding loop and its children together', () => {
      const { batchAddBlocks } = useWorkflowStore.getState()

      // Add loop and child in same batch
      batchAddBlocks([
        {
          id: 'loop-1',
          type: 'loop',
          name: 'Loop 1',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { loopType: 'for', count: 5 },
        },
        {
          id: 'child-1',
          type: 'function',
          name: 'Child 1',
          position: { x: 50, y: 50 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { parentId: 'loop-1' },
        },
      ])

      const state = useWorkflowStore.getState()
      expect(state.loops['loop-1']).toBeDefined()
      expect(state.loops['loop-1'].nodes).toContain('child-1')
    })
  })

  describe('batchToggleLocked', () => {
    it('should cascade lock to children when locking a loop', () => {
      const { batchToggleLocked } = useWorkflowStore.getState()

      addBlock('loop-1', 'loop', 'My Loop', { x: 0, y: 0 }, { loopType: 'for', count: 3 })
      addBlock(
        'child-1',
        'function',
        'Child',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )

      batchToggleLocked(['loop-1'])

      const { blocks } = useWorkflowStore.getState()
      expect(blocks['loop-1'].locked).toBe(true)
      expect(blocks['child-1'].locked).toBe(true)
    })

    it('should cascade unlock to children when unlocking a parallel', () => {
      const { batchToggleLocked } = useWorkflowStore.getState()

      addBlock('parallel-1', 'parallel', 'My Parallel', { x: 0, y: 0 }, { count: 3 })
      addBlock(
        'child-1',
        'function',
        'Child',
        { x: 50, y: 50 },
        { parentId: 'parallel-1' },
        'parallel-1',
        'parent'
      )

      // Lock first
      batchToggleLocked(['parallel-1'])
      expect(useWorkflowStore.getState().blocks['child-1'].locked).toBe(true)

      // Unlock
      batchToggleLocked(['parallel-1'])

      const { blocks } = useWorkflowStore.getState()
      expect(blocks['parallel-1'].locked).toBe(false)
      expect(blocks['child-1'].locked).toBe(false)
    })
  })

  describe('duplicateBlock with locked', () => {
    it('should unlock duplicate when duplicating a locked block', () => {
      const { setBlockLocked, duplicateBlock } = useWorkflowStore.getState()

      addBlock('original', 'agent', 'Original Agent', { x: 0, y: 0 })
      setBlockLocked('original', true)

      expect(useWorkflowStore.getState().blocks.original.locked).toBe(true)

      duplicateBlock('original')

      const { blocks } = useWorkflowStore.getState()
      const blockIds = Object.keys(blocks)

      expect(blockIds.length).toBe(2)

      const duplicatedId = blockIds.find((id) => id !== 'original')
      expect(duplicatedId).toBeDefined()

      if (duplicatedId) {
        // Original should still be locked
        expect(blocks.original.locked).toBe(true)
        // Duplicate should be unlocked so users can edit it
        expect(blocks[duplicatedId].locked).toBe(false)
      }
    })

    it('should place duplicate outside locked container when duplicating block inside locked loop', () => {
      const { batchToggleLocked, duplicateBlock } = useWorkflowStore.getState()

      // Create a loop with a child block
      addBlock('loop-1', 'loop', 'My Loop', { x: 0, y: 0 }, { loopType: 'for', count: 3 })
      addBlock(
        'child-1',
        'function',
        'Child',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )

      // Lock the loop (which cascades to the child)
      batchToggleLocked(['loop-1'])
      expect(useWorkflowStore.getState().blocks['child-1'].locked).toBe(true)

      // Duplicate the child block
      duplicateBlock('child-1')

      const { blocks } = useWorkflowStore.getState()
      const blockIds = Object.keys(blocks)

      expect(blockIds.length).toBe(3) // loop, original child, duplicate

      const duplicatedId = blockIds.find((id) => id !== 'loop-1' && id !== 'child-1')
      expect(duplicatedId).toBeDefined()

      if (duplicatedId) {
        // Duplicate should be unlocked
        expect(blocks[duplicatedId].locked).toBe(false)
        // Duplicate should NOT have a parentId (placed outside the locked container)
        expect(blocks[duplicatedId].data?.parentId).toBeUndefined()
        // Original should still be inside the loop
        expect(blocks['child-1'].data?.parentId).toBe('loop-1')
      }
    })
  })

  describe('updateBlockName', () => {
    beforeEach(() => {
      useWorkflowStore.setState({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      })

      addBlock('block1', 'agent', 'Column AD', { x: 0, y: 0 })
      addBlock('block2', 'function', 'Employee Length', { x: 100, y: 0 })
      addBlock('block3', 'starter', 'Start', { x: 200, y: 0 })
    })

    it('should allow renaming a block to a different case/spacing of its current name', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('block1', 'column ad')

      expect(result.success).toBe(true)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block1.name).toBe('column ad')
    })

    it('should prevent renaming when another block has the same normalized name', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('block2', 'Column AD')

      expect(result.success).toBe(false)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block2.name).toBe('Employee Length')
    })

    it('should reject empty or whitespace-only names', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result1 = updateBlockName('block1', '')
      expect(result1.success).toBe(false)

      const result2 = updateBlockName('block2', '   ')
      expect(result2.success).toBe(false)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block1.name).toBe('Column AD')
      expect(state.blocks.block2.name).toBe('Employee Length')
    })

    it('should reject reserved names (loop, parallel, variable)', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      for (const reserved of ['loop', 'Parallel', 'VARIABLE']) {
        const result = updateBlockName('block1', reserved)
        expect(result.success).toBe(false)
      }

      const state = useWorkflowStore.getState()
      expect(state.blocks.block1.name).toBe('Column AD')
    })

    it('should handle complex normalization cases correctly', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const conflictingNames = [
        'column ad',
        'COLUMN AD',
        'Column  AD',
        'columnad',
        'ColumnAD',
        'COLUMNAD',
      ]

      for (const name of conflictingNames) {
        const result = updateBlockName('block2', name)
        expect(result.success).toBe(false)
      }

      const result = updateBlockName('block2', 'Unique Name')
      expect(result.success).toBe(true)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block2.name).toBe('Unique Name')
    })
  })
})
