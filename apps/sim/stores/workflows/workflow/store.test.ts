import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

describe('workflow store', () => {
  beforeEach(() => {
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    }
    global.localStorage = localStorageMock as any

    useWorkflowStore.setState({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  describe('loop management', () => {
    it('should regenerate loops when updateLoopCount is called', () => {
      const { addBlock, updateLoopCount } = useWorkflowStore.getState()

      // Add a loop block
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

      // Update loop count
      updateLoopCount('loop1', 10)

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.loop1?.data?.count).toBe(10)

      // Check that loops were regenerated
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.iterations).toBe(10)
    })

    it('should regenerate loops when updateLoopType is called', () => {
      const { addBlock, updateLoopType } = useWorkflowStore.getState()

      // Add a loop block
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

      // Update loop type
      updateLoopType('loop1', 'forEach')

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.loop1?.data?.loopType).toBe('forEach')

      // Check that loops were regenerated with forEach items
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.loopType).toBe('forEach')
      expect(state.loops.loop1.forEachItems).toEqual(['a', 'b', 'c'])
    })

    it('should regenerate loops when updateLoopCollection is called', () => {
      const { addBlock, updateLoopCollection } = useWorkflowStore.getState()

      // Add a forEach loop block
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

      // Update loop collection
      updateLoopCollection('loop1', '["item1", "item2", "item3"]')

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.loop1?.data?.collection).toBe('["item1", "item2", "item3"]')

      // Check that loops were regenerated with new items
      expect(state.loops.loop1).toBeDefined()
      expect(state.loops.loop1.forEachItems).toEqual(['item1', 'item2', 'item3'])
    })

    it('should clamp loop count between 1 and 50', () => {
      const { addBlock, updateLoopCount } = useWorkflowStore.getState()

      // Add a loop block
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

      // Try to set count above max
      updateLoopCount('loop1', 150)
      let state = useWorkflowStore.getState()
      expect(state.blocks.loop1?.data?.count).toBe(100)

      // Try to set count below min
      updateLoopCount('loop1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.loop1?.data?.count).toBe(1)
    })
  })

  describe('parallel management', () => {
    it('should regenerate parallels when updateParallelCount is called', () => {
      const { addBlock, updateParallelCount } = useWorkflowStore.getState()

      // Add a parallel block
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

      // Update parallel count
      updateParallelCount('parallel1', 5)

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.parallel1?.data?.count).toBe(5)

      // Check that parallels were regenerated
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.distribution).toBe('')
    })

    it('should regenerate parallels when updateParallelCollection is called', () => {
      const { addBlock, updateParallelCollection } = useWorkflowStore.getState()

      // Add a parallel block
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

      // Update parallel collection
      updateParallelCollection('parallel1', '["item1", "item2", "item3"]')

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.parallel1?.data?.collection).toBe('["item1", "item2", "item3"]')

      // Check that parallels were regenerated
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.distribution).toBe('["item1", "item2", "item3"]')

      // Verify that the parallel count matches the collection size
      const parsedDistribution = JSON.parse(state.parallels.parallel1.distribution as string)
      expect(parsedDistribution).toHaveLength(3)
    })

    it('should clamp parallel count between 1 and 50', () => {
      const { addBlock, updateParallelCount } = useWorkflowStore.getState()

      // Add a parallel block
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

      // Try to set count above max
      updateParallelCount('parallel1', 100)
      let state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(20)

      // Try to set count below min
      updateParallelCount('parallel1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(1)
    })

    it('should regenerate parallels when updateParallelType is called', () => {
      const { addBlock, updateParallelType } = useWorkflowStore.getState()

      // Add a parallel block with default collection type
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

      // Update parallel type to count
      updateParallelType('parallel1', 'count')

      const state = useWorkflowStore.getState()

      // Check that block data was updated
      expect(state.blocks.parallel1?.data?.parallelType).toBe('count')

      // Check that parallels were regenerated with new type
      expect(state.parallels.parallel1).toBeDefined()
      expect(state.parallels.parallel1.parallelType).toBe('count')
    })

    it('should save to history when updating parallel properties', () => {
      const { addBlock, updateParallelCollection, updateParallelCount, updateParallelType } =
        useWorkflowStore.getState()

      // Add a parallel block
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

      // Get initial history length
      const initialHistoryLength = useWorkflowStore.getState().history.past.length

      // Update collection
      updateParallelCollection('parallel1', '["a", "b", "c"]')

      let state = useWorkflowStore.getState()
      expect(state.history.past.length).toBe(initialHistoryLength + 1)

      // Update count
      updateParallelCount('parallel1', 5)

      state = useWorkflowStore.getState()
      expect(state.history.past.length).toBe(initialHistoryLength + 2)

      // Update parallel type
      updateParallelType('parallel1', 'count')

      state = useWorkflowStore.getState()
      expect(state.history.past.length).toBe(initialHistoryLength + 3)
    })
  })

  describe('mode switching', () => {
    it('should toggle advanced mode on a block', () => {
      const { addBlock, toggleBlockAdvancedMode } = useWorkflowStore.getState()

      // Add an agent block
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      // Initially should be in basic mode (advancedMode: false)
      let state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(false)

      // Toggle to advanced mode
      toggleBlockAdvancedMode('agent1')
      state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(true)

      // Toggle back to basic mode
      toggleBlockAdvancedMode('agent1')
      state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(false)
    })

    it('should preserve systemPrompt and userPrompt when switching modes', () => {
      const { addBlock, toggleBlockAdvancedMode } = useWorkflowStore.getState()
      const { setState: setSubBlockState } = useSubBlockStore
      // Set up a mock active workflow
      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })
      // Add an agent block
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })
      // Set initial values in basic mode
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
      // Toggle to advanced mode
      toggleBlockAdvancedMode('agent1')
      // Check that prompts are preserved in advanced mode
      let subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'Hello, how are you?'
      )
      // Toggle back to basic mode
      toggleBlockAdvancedMode('agent1')
      // Check that prompts are still preserved
      subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'Hello, how are you?'
      )
    })

    it('should clear memories when switching from advanced to basic mode', () => {
      const { addBlock, toggleBlockAdvancedMode } = useWorkflowStore.getState()
      const { setState: setSubBlockState } = useSubBlockStore

      // Set up a mock active workflow
      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })

      // Add an agent block in advanced mode
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      // First toggle to advanced mode
      toggleBlockAdvancedMode('agent1')

      // Set values including memories
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

      // Toggle back to basic mode
      toggleBlockAdvancedMode('agent1')

      // Check that prompts are preserved but memories are cleared
      const subBlockState = useSubBlockStore.getState()
      expect(subBlockState.workflowValues['test-workflow'].agent1.systemPrompt).toBe(
        'You are a helpful assistant'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.userPrompt).toBe(
        'What did we discuss?'
      )
      expect(subBlockState.workflowValues['test-workflow'].agent1.memories).toBeNull()
    })

    it('should handle mode switching when no subblock values exist', () => {
      const { addBlock, toggleBlockAdvancedMode } = useWorkflowStore.getState()

      // Set up a mock active workflow
      useWorkflowRegistry.setState({ activeWorkflowId: 'test-workflow' })

      // Add an agent block
      addBlock('agent1', 'agent', 'Test Agent', { x: 0, y: 0 })

      // Toggle modes without any subblock values set
      expect(useWorkflowStore.getState().blocks.agent1?.advancedMode).toBe(false)
      expect(() => toggleBlockAdvancedMode('agent1')).not.toThrow()

      // Verify the mode changed
      const state = useWorkflowStore.getState()
      expect(state.blocks.agent1?.advancedMode).toBe(true)
    })

    it('should not throw when toggling non-existent block', () => {
      const { toggleBlockAdvancedMode } = useWorkflowStore.getState()

      // Try to toggle a block that doesn't exist
      expect(() => toggleBlockAdvancedMode('non-existent')).not.toThrow()
    })
  })

  describe('addBlock with blockProperties', () => {
    it('should create a block with default properties when no blockProperties provided', () => {
      const { addBlock } = useWorkflowStore.getState()

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
      expect(block.isWide).toBe(false)
      expect(block.height).toBe(0)
    })

    it('should create a block with custom blockProperties for regular blocks', () => {
      const { addBlock } = useWorkflowStore.getState()

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
          isWide: true,
          advancedMode: true,
          height: 300,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.agent1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.isWide).toBe(true)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(300)
    })

    it('should create a loop block with custom blockProperties', () => {
      const { addBlock } = useWorkflowStore.getState()

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
          isWide: true,
          advancedMode: true,
          height: 250,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.loop1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.isWide).toBe(true)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(250)
    })

    it('should create a parallel block with custom blockProperties', () => {
      const { addBlock } = useWorkflowStore.getState()

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
          isWide: true,
          advancedMode: true,
          height: 400,
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.parallel1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(false)
      expect(block.horizontalHandles).toBe(false)
      expect(block.isWide).toBe(true)
      expect(block.advancedMode).toBe(true)
      expect(block.height).toBe(400)
    })

    it('should handle partial blockProperties (only some properties provided)', () => {
      const { addBlock } = useWorkflowStore.getState()

      addBlock(
        'agent1',
        'agent',
        'Test Agent',
        { x: 100, y: 200 },
        undefined,
        undefined,
        undefined,
        {
          isWide: true,
          // Only isWide provided, others should use defaults
        }
      )

      const state = useWorkflowStore.getState()
      const block = state.blocks.agent1

      expect(block).toBeDefined()
      expect(block.enabled).toBe(true) // default
      expect(block.horizontalHandles).toBe(true) // default
      expect(block.isWide).toBe(true) // custom
      expect(block.advancedMode).toBe(false) // default
      expect(block.height).toBe(0) // default
    })

    it('should handle blockProperties with parent relationships', () => {
      const { addBlock } = useWorkflowStore.getState()

      // First add a parent loop block
      addBlock('loop1', 'loop', 'Parent Loop', { x: 0, y: 0 })

      // Then add a child block with custom properties
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
          isWide: true,
          advancedMode: true,
          height: 200,
        }
      )

      const state = useWorkflowStore.getState()
      const childBlock = state.blocks.agent1

      expect(childBlock).toBeDefined()
      expect(childBlock.enabled).toBe(false)
      expect(childBlock.isWide).toBe(true)
      expect(childBlock.advancedMode).toBe(true)
      expect(childBlock.height).toBe(200)
      expect(childBlock.data?.parentId).toBe('loop1')
      expect(childBlock.data?.extent).toBe('parent')
    })
  })
})
