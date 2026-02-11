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

import {
  createMockStorage,
  expectBlockCount,
  expectBlockExists,
  expectBlockNotExists,
  expectEdgeConnects,
  expectEdgeCount,
  expectNoEdgeBetween,
  WorkflowBuilder,
} from '@sim/testing'
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

  describe('batchAddBlocks (via addBlock helper)', () => {
    it('should add a block with correct default properties', () => {
      addBlock('agent-1', 'agent', 'My Agent', { x: 100, y: 200 })

      const { blocks } = useWorkflowStore.getState()
      expectBlockExists(blocks, 'agent-1', 'agent')
      expect(blocks['agent-1'].name).toBe('My Agent')
      expect(blocks['agent-1'].position).toEqual({ x: 100, y: 200 })
      expect(blocks['agent-1'].enabled).toBe(true)
    })

    it('should add a block with parent relationship for containers', () => {
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

      const { blocks } = useWorkflowStore.getState()
      expectBlockExists(blocks, 'child-1', 'function')
      expect(blocks['child-1'].data?.parentId).toBe('loop-1')
      expect(blocks['child-1'].data?.extent).toBe('parent')
    })

    it('should add multiple blocks correctly', () => {
      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'agent', 'Agent', { x: 200, y: 0 })
      addBlock('block-3', 'function', 'Function', { x: 400, y: 0 })

      const { blocks } = useWorkflowStore.getState()
      expectBlockCount({ blocks, edges: [], loops: {}, parallels: {} }, 3)
      expectBlockExists(blocks, 'block-1', 'starter')
      expectBlockExists(blocks, 'block-2', 'agent')
      expectBlockExists(blocks, 'block-3', 'function')
    })

    it('should create a block with default properties when no blockProperties provided', () => {
      addBlock('agent1', 'agent', 'Test Agent', { x: 100, y: 200 })

      const state = useWorkflowStore.getState()
      const block = state.blocks.agent1

      expect(block).toBeDefined()
      expect(block.id).toBe('agent1')
      expect(block.type).toBe('agent')
      expect(block.name).toBe('Test Agent')
      expect(block.position).toEqual({ x: 100, y: 200 })
      expect(block.enabled).toBe(true)
      expect(block.horizontalHandles).toBe(true)
      expect(block.height).toBe(0)
    })

    it('should create a block with custom blockProperties for regular blocks', () => {
      addBlock(
        'agent1',
        'agent',
        'Test Agent',
        { x: 100, y: 200 },
        { someData: 'test' },
        undefined,
        undefined,
        {
          enabled: false,
          horizontalHandles: false,
          advancedMode: true,
          height: 300,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.agent1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(300)
    })

    it('should create a loop block with custom blockProperties', () => {
      addBlock(
        'loop1',
        'loop',
        'Test Loop',
        { x: 0, y: 0 },
        { loopType: 'for', count: 5 },
        undefined,
        undefined,
        {
          enabled: false,
          horizontalHandles: false,
          advancedMode: true,
          height: 250,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.loop1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(250)
    })

    it('should create a parallel block with custom blockProperties', () => {
      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        { count: 3 },
        undefined,
        undefined,
        {
          enabled: false,
          horizontalHandles: false,
          advancedMode: true,
          height: 400,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.parallel1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(400)
    })

    it('should handle partial blockProperties (only some properties provided)', () => {
      addBlock(
        'agent1',
        'agent',
        'Test Agent',
        { x: 100, y: 200 },
        undefined,
        undefined,
        undefined,
        {}
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.agent1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(true)
      expect(block.horizontalHandles).toBe(true)
      expect(block.advancedMode).toBe(false)
      expect(block.height).toBe(0)
    })

    it('should handle blockProperties with parent relationships', () => {
      addBlock('loop1', 'loop', 'Parent Loop', { x: 0, y: 0 })

      addBlock(
        'agent1',
        'agent',
        'Child Agent',
        { x: 50, y: 50 },
        { parentId: 'loop1' },
        'loop1',
        'parent',
        {
          enabled: false,
          advancedMode: true,
          height: 200,
        }
      )

      const state = useWorkflowStore.getState()
      const childBlock = state.blocks.agent1

      expect(childBlock).toBeDefined()
      expect(childBlock.enabled).toBe(false)
      expect(childBlock.advancedMode).toBe(true)
      expect(childBlock.height).toBe(200)
      expect(childBlock.data?.parentId).toBe('loop1')
      expect(childBlock.data?.extent).toBe('parent')
    })
  })

  describe('batchRemoveBlocks', () => {
    it('should remove a block', () => {
      const { batchRemoveBlocks } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })
      batchRemoveBlocks(['block-1'])

      const { blocks } = useWorkflowStore.getState()
      expectBlockNotExists(blocks, 'block-1')
    })

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

    it('should not throw when removing non-existent block', () => {
      const { batchRemoveBlocks } = useWorkflowStore.getState()

      expect(() => batchRemoveBlocks(['non-existent'])).not.toThrow()
    })
  })

  describe('batchAddEdges', () => {
    it('should add an edge between two blocks', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])

      const { edges } = useWorkflowStore.getState()
      expectEdgeConnects(edges, 'block-1', 'block-2')
    })

    it('should not add duplicate connections', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])
      batchAddEdges([{ id: 'e2', source: 'block-1', target: 'block-2' }])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 1)
    })
  })

  describe('batchRemoveEdges', () => {
    it('should remove an edge by id', () => {
      const { batchAddEdges, batchRemoveEdges } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })
      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])

      batchRemoveEdges(['e1'])

      const state = useWorkflowStore.getState()
      expectEdgeCount(state, 0)
      expectNoEdgeBetween(state.edges, 'block-1', 'block-2')
    })

    it('should not throw when removing non-existent edge', () => {
      const { batchRemoveEdges } = useWorkflowStore.getState()

      expect(() => batchRemoveEdges(['non-existent'])).not.toThrow()
    })
  })

  describe('clear', () => {
    it('should clear all blocks and edges', () => {
      const { batchAddEdges, clear } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })
      batchAddEdges([{ id: 'e1', source: 'block-1', target: 'block-2' }])

      clear()

      const state = useWorkflowStore.getState()
      expectBlockCount(state, 0)
      expectEdgeCount(state, 0)
    })
  })

  describe('batchToggleEnabled', () => {
    it('should toggle block enabled state', () => {
      const { batchToggleEnabled } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })

      expect(useWorkflowStore.getState().blocks['block-1'].enabled).toBe(true)

      batchToggleEnabled(['block-1'])
      expect(useWorkflowStore.getState().blocks['block-1'].enabled).toBe(false)

      batchToggleEnabled(['block-1'])
      expect(useWorkflowStore.getState().blocks['block-1'].enabled).toBe(true)
    })
  })

  describe('duplicateBlock', () => {
    it('should duplicate a block', () => {
      const { duplicateBlock } = useWorkflowStore.getState()

      addBlock('original', 'agent', 'Original Agent', { x: 0, y: 0 })

      duplicateBlock('original')

      const { blocks } = useWorkflowStore.getState()
      const blockIds = Object.keys(blocks)

      expect(blockIds.length).toBe(2)

      const duplicatedId = blockIds.find((id) => id !== 'original')
      expect(duplicatedId).toBeDefined()

      if (duplicatedId) {
        expect(blocks[duplicatedId].type).toBe('agent')
        expect(blocks[duplicatedId].name).toContain('Original Agent')
        expect(blocks[duplicatedId].position.x).not.toBe(0)
      }
    })
  })

  describe('batchUpdatePositions', () => {
    it('should update block position', () => {
      const { batchUpdatePositions } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })

      batchUpdatePositions([{ id: 'block-1', position: { x: 100, y: 200 } }])

      const { blocks } = useWorkflowStore.getState()
      expect(blocks['block-1'].position).toEqual({ x: 100, y: 200 })
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

    it('should regenerate loops when updateLoopType is called', () => {
      const { updateLoopType } = useWorkflowStore.getState()

      addBlock(
        'loop1',
        'loop',
        'Test Loop',
        { x: 0, y: 0 },
        {
          loopType: 'for',
          count: 5,
          collection: '["a", "b", "c"]',
        }
      )

      updateLoopType('loop1', 'forEach')

      const state = useWorkflowStore.getState()

      expect(state.blocks.loop1?.data?.loopType).toBe('forEach')
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.loopType).toBe('forEach')
      expect(state.loops.loop1.forEachItems).toBe('["a", "b", "c"]')
    })

    it('should regenerate loops when updateLoopCollection is called', () => {
      const { updateLoopCollection } = useWorkflowStore.getState()

      addBlock(
        'loop1',
        'loop',
        'Test Loop',
        { x: 0, y: 0 },
        {
          loopType: 'forEach',
          collection: '["item1", "item2"]',
        }
      )

      updateLoopCollection('loop1', '["item1", "item2", "item3"]')

      const state = useWorkflowStore.getState()

      expect(state.blocks.loop1?.data?.collection).toBe('["item1", "item2", "item3"]')
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.forEachItems).toBe('["item1", "item2", "item3"]')
    })

    it('should clamp loop count between 1 and 1000', () => {
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
      expect(state.blocks.loop1?.data?.count).toBe(1000)

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

    it('should regenerate parallels when updateParallelCollection is called', () => {
      const { updateParallelCollection } = useWorkflowStore.getState()

      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        {
          count: 3,
          collection: '["item1", "item2"]',
          parallelType: 'collection',
        }
      )

      updateParallelCollection('parallel1', '["item1", "item2", "item3"]')

      const state = useWorkflowStore.getState()

      expect(state.blocks.parallel1?.data?.collection).toBe('["item1", "item2", "item3"]')
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.distribution).toBe('["item1", "item2", "item3"]')

      const parsedDistribution = JSON.parse(state.parallels.parallel1.distribution as string)
      expect(parsedDistribution).toHaveLength(3)
    })

    it('should clamp parallel count between 1 and 20', () => {
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
      expect(state.blocks.parallel1?.data?.count).toBe(20)

      updateParallelCount('parallel1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(1)
    })

    it('should regenerate parallels when updateParallelType is called', () => {
      const { updateParallelType } = useWorkflowStore.getState()

      addBlock(
        'parallel1',
        'parallel',
        'Test Parallel',
        { x: 0, y: 0 },
        {
          parallelType: 'collection',
          count: 3,
          collection: '["a", "b", "c"]',
        }
      )

      updateParallelType('parallel1', 'count')

      const state = useWorkflowStore.getState()

      expect(state.blocks.parallel1?.data?.parallelType).toBe('count')
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.parallelType).toBe('count')
    })
  })

  describe('mode switching', () => {
    it('should toggle advanced mode on a block', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()

      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      let state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(false)

      toggleBlockAdvancedMode('agent1')
      state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(true)

      toggleBlockAdvancedMode('agent1')
      state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(false)
    })

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

    it('should handle mode switching when no subblock values exist', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()

      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })

      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      expect(useWorkflowStore.getState().blocks.agent1?.advancedMode).toBe(false)
      expect(() => toggleBlockAdvancedMode('agent1')).not.toThrow()

      const state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(true)
    })

    it('should not throw when toggling non-existent block', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()

      expect(() => toggleBlockAdvancedMode('non-existent')).not.toThrow()
    })
  })

  describe('workflow state management', () => {
    it('should work with WorkflowBuilder for complex setups', () => {
      const workflowState = WorkflowBuilder.linear(3).build()

      useWorkflowStore.setState(workflowState)

      const state = useWorkflowStore.getState()
      expectBlockCount(state, 3)
      expectEdgeCount(state, 2)
      expectBlockExists(state.blocks, 'block-0', 'starter')
      expectEdgeConnects(state.edges, 'block-0', 'block-1')
      expectEdgeConnects(state.edges, 'block-1', 'block-2')
    })

    it('should work with branching workflow', () => {
      const workflowState = WorkflowBuilder.branching().build()

      useWorkflowStore.setState(workflowState)

      const state = useWorkflowStore.getState()
      expectBlockCount(state, 5)
      expectBlockExists(state.blocks, 'start', 'starter')
      expectBlockExists(state.blocks, 'condition', 'condition')
      expectBlockExists(state.blocks, 'true-branch', 'function')
      expectBlockExists(state.blocks, 'false-branch', 'function')
      expectBlockExists(state.blocks, 'end', 'function')
    })

    it('should work with loop workflow', () => {
      const workflowState = WorkflowBuilder.withLoop(5).build()

      useWorkflowStore.setState(workflowState)

      const state = useWorkflowStore.getState()
      expect(state.loops.loop).toBeDefined()
      expect(state.loops.loop.iterations).toBe(5)
      expect(state.loops.loop.nodes).toContain('loop-body')
    })
  })

  describe('replaceWorkflowState', () => {
    it('should replace entire workflow state', () => {
      const { replaceWorkflowState } = useWorkflowStore.getState()

      addBlock('old-1', 'function', 'Old', { x: 0, y: 0 })

      const newState = WorkflowBuilder.linear(2).build()
      replaceWorkflowState(newState)

      const state = useWorkflowStore.getState()
      expectBlockNotExists(state.blocks, 'old-1')
      expectBlockExists(state.blocks, 'block-0', 'starter')
      expectBlockExists(state.blocks, 'block-1', 'function')
    })
  })

  describe('getWorkflowState', () => {
    it('should return current workflow state', () => {
      const { getWorkflowState } = useWorkflowStore.getState()

      addBlock('block-1', 'starter', 'Start', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'End', { x: 200, y: 0 })

      const state = getWorkflowState()

      expectBlockCount(state, 2)
      expectBlockExists(state.blocks, 'block-1')
      expectBlockExists(state.blocks, 'block-2')
    })
  })

  describe('loop/parallel regeneration optimization', () => {
    it('should NOT regenerate loops when adding a regular block without parentId', () => {
      // Add a loop first
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })

      const stateAfterLoop = useWorkflowStore.getState()
      const loopsAfterLoop = stateAfterLoop.loops

      // Add a regular block (no parentId)
      addBlock('agent-1', 'agent', 'Agent 1', { x: 200, y: 0 })

      const stateAfterAgent = useWorkflowStore.getState()

      // Loops should be unchanged (same content)
      expect(Object.keys(stateAfterAgent.loops)).toEqual(Object.keys(loopsAfterLoop))
      expect(stateAfterAgent.loops['loop-1'].nodes).toEqual(loopsAfterLoop['loop-1'].nodes)
    })

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

    it('should NOT regenerate parallels when adding a child to a loop', () => {
      // Add both a loop and a parallel
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })
      addBlock('parallel-1', 'parallel', 'Parallel 1', { x: 300, y: 0 }, { count: 3 })

      const stateAfterContainers = useWorkflowStore.getState()
      const parallelsAfterContainers = stateAfterContainers.parallels

      // Add a child to the loop (not the parallel)
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

      // Parallels should be unchanged
      expect(stateAfterChild.parallels['parallel-1'].nodes).toEqual(
        parallelsAfterContainers['parallel-1'].nodes
      )
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
    it('should NOT regenerate loops/parallels when adding regular blocks', () => {
      const { batchAddBlocks } = useWorkflowStore.getState()

      // Set up initial state with a loop
      useWorkflowStore.setState({
        blocks: {
          'loop-1': {
            id: 'loop-1',
            type: 'loop',
            name: 'Loop 1',
            position: { x: 0, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            advancedMode: false,
            triggerMode: false,
            height: 0,
            data: { loopType: 'for', count: 5 },
          },
        },
        edges: [],
        loops: {
          'loop-1': {
            id: 'loop-1',
            nodes: [],
            iterations: 5,
            loopType: 'for',
            enabled: true,
          },
        },
        parallels: {},
      })

      const stateBefore = useWorkflowStore.getState()

      // Add regular blocks (no parentId, not loop/parallel type)
      batchAddBlocks([
        {
          id: 'agent-1',
          type: 'agent',
          name: 'Agent 1',
          position: { x: 200, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
        {
          id: 'function-1',
          type: 'function',
          name: 'Function 1',
          position: { x: 400, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      ])

      const stateAfter = useWorkflowStore.getState()

      // Loops should be unchanged
      expect(stateAfter.loops['loop-1'].nodes).toEqual(stateBefore.loops['loop-1'].nodes)
    })

    it('should regenerate loops when batch adding a loop block', () => {
      const { batchAddBlocks } = useWorkflowStore.getState()

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

      const state = useWorkflowStore.getState()
      expect(state.loops['loop-1']).toBeDefined()
      expect(state.loops['loop-1'].iterations).toBe(5)
    })

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

  describe('edge operations should not affect loops/parallels', () => {
    it('should preserve loops when adding edges', () => {
      const { batchAddEdges } = useWorkflowStore.getState()

      // Create a loop with a child
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })
      addBlock(
        'child-1',
        'function',
        'Child 1',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )
      addBlock('external-1', 'function', 'External', { x: 300, y: 0 })

      const stateBeforeEdge = useWorkflowStore.getState()
      const loopsBeforeEdge = stateBeforeEdge.loops

      // Add an edge (should not affect loops)
      batchAddEdges([{ id: 'e1', source: 'loop-1', target: 'external-1' }])

      const stateAfterEdge = useWorkflowStore.getState()

      // Loops should be unchanged
      expect(stateAfterEdge.loops['loop-1'].nodes).toEqual(loopsBeforeEdge['loop-1'].nodes)
      expect(stateAfterEdge.loops['loop-1'].iterations).toEqual(
        loopsBeforeEdge['loop-1'].iterations
      )
    })

    it('should preserve loops when removing edges', () => {
      const { batchAddEdges, batchRemoveEdges } = useWorkflowStore.getState()

      // Create a loop with a child and an edge
      addBlock('loop-1', 'loop', 'Loop 1', { x: 0, y: 0 }, { loopType: 'for', count: 5 })
      addBlock(
        'child-1',
        'function',
        'Child 1',
        { x: 50, y: 50 },
        { parentId: 'loop-1' },
        'loop-1',
        'parent'
      )
      addBlock('external-1', 'function', 'External', { x: 300, y: 0 })
      batchAddEdges([{ id: 'e1', source: 'loop-1', target: 'external-1' }])

      const stateBeforeRemove = useWorkflowStore.getState()
      const loopsBeforeRemove = stateBeforeRemove.loops

      // Remove the edge
      batchRemoveEdges(['e1'])

      const stateAfterRemove = useWorkflowStore.getState()

      // Loops should be unchanged
      expect(stateAfterRemove.loops['loop-1'].nodes).toEqual(loopsBeforeRemove['loop-1'].nodes)
    })
  })

  describe('batchToggleLocked', () => {
    it('should toggle block locked state', () => {
      const { batchToggleLocked } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })

      // Initial state is undefined (falsy)
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBeFalsy()

      batchToggleLocked(['block-1'])
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(true)

      batchToggleLocked(['block-1'])
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(false)
    })

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

    it('should toggle multiple blocks at once', () => {
      const { batchToggleLocked } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test 1', { x: 0, y: 0 })
      addBlock('block-2', 'function', 'Test 2', { x: 100, y: 0 })

      batchToggleLocked(['block-1', 'block-2'])

      const { blocks } = useWorkflowStore.getState()
      expect(blocks['block-1'].locked).toBe(true)
      expect(blocks['block-2'].locked).toBe(true)
    })
  })

  describe('setBlockLocked', () => {
    it('should set block locked state', () => {
      const { setBlockLocked } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })

      setBlockLocked('block-1', true)
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(true)

      setBlockLocked('block-1', false)
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(false)
    })

    it('should not update if locked state is already the target value', () => {
      const { setBlockLocked } = useWorkflowStore.getState()

      addBlock('block-1', 'function', 'Test', { x: 0, y: 0 })

      // First set to true
      setBlockLocked('block-1', true)
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(true)

      // Setting to true again should still be true
      setBlockLocked('block-1', true)
      expect(useWorkflowStore.getState().blocks['block-1'].locked).toBe(true)
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

    it('should create unlocked duplicate when duplicating an unlocked block', () => {
      const { duplicateBlock } = useWorkflowStore.getState()

      addBlock('original', 'agent', 'Original Agent', { x: 0, y: 0 })

      duplicateBlock('original')

      const { blocks } = useWorkflowStore.getState()
      const blockIds = Object.keys(blocks)
      const duplicatedId = blockIds.find((id) => id !== 'original')

      if (duplicatedId) {
        expect(blocks[duplicatedId].locked).toBeFalsy()
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

    it('should keep duplicate inside unlocked container when duplicating block inside unlocked loop', () => {
      const { duplicateBlock } = useWorkflowStore.getState()

      // Create a loop with a child block (not locked)
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

      // Duplicate the child block (loop is NOT locked)
      duplicateBlock('child-1')

      const { blocks } = useWorkflowStore.getState()
      const blockIds = Object.keys(blocks)
      const duplicatedId = blockIds.find((id) => id !== 'loop-1' && id !== 'child-1')

      if (duplicatedId) {
        // Duplicate should still be inside the loop since it's not locked
        expect(blocks[duplicatedId].data?.parentId).toBe('loop-1')
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

    it('should have test blocks set up correctly', () => {
      const state = useWorkflowStore.getState()

      expect(state.blocks.block1).toBeDefined()
      expect(state.blocks.block1.name).toBe('Column AD')
      expect(state.blocks.block2).toBeDefined()
      expect(state.blocks.block2.name).toBe('Employee Length')
      expect(state.blocks.block3).toBeDefined()
      expect(state.blocks.block3.name).toBe('Start')
    })

    it('should successfully rename a block when no conflicts exist', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('block1', 'Data Processor')

      expect(result.success).toBe(true)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block1.name).toBe('Data Processor')
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

    it('should prevent renaming when another block has a name that normalizes to the same value', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('block2', 'columnad')

      expect(result.success).toBe(false)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block2.name).toBe('Employee Length')
    })

    it('should prevent renaming when another block has a similar name with different spacing', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('block3', 'employee length')

      expect(result.success).toBe(false)

      const state = useWorkflowStore.getState()
      expect(state.blocks.block3.name).toBe('Start')
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

    it('should return false when trying to rename a non-existent block', () => {
      const { updateBlockName } = useWorkflowStore.getState()

      const result = updateBlockName('nonexistent', 'New Name')

      expect(result.success).toBe(false)
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
