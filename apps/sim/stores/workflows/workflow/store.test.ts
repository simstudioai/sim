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
          count: 10,
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
})
