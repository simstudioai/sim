import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkflowStore } from './store'

describe('workflow store', () => {
  beforeEach(() => {
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
      updateLoopCount('loop1', 100)
      let state = useWorkflowStore.getState()
      expect(state.blocks.loop1?.data?.count).toBe(50)

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
      expect(state.blocks.parallel1?.data?.count).toBe(50)

      // Try to set count below min
      updateParallelCount('parallel1', 0)
      state = useWorkflowStore.getState()
      expect(state.blocks.parallel1?.data?.count).toBe(1)
    })

    it('should save to history when updating parallel properties', () => {
      const { addBlock, updateParallelCollection, updateParallelCount } =
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
    })
  })
})
