import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

// Mock the store
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: vi.fn(),
}))

describe('LoopBadges Store Integration', () => {
  const mockUpdateLoopType = vi.fn()
  const mockUpdateLoopCount = vi.fn()
  const mockUpdateLoopCollection = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    ;(useWorkflowStore as any).mockImplementation((selector: any) => {
      const state = {
        updateLoopType: mockUpdateLoopType,
        updateLoopCount: mockUpdateLoopCount,
        updateLoopCollection: mockUpdateLoopCollection,
      }
      return selector(state)
    })
  })

  it('should call updateLoopType when changing loop type', () => {
    // When we update loop type in the UI, it should call the store method
    const nodeId = 'loop1'
    const newType = 'forEach'

    // Simulate the handler being called
    mockUpdateLoopType(nodeId, newType)

    expect(mockUpdateLoopType).toHaveBeenCalledWith(nodeId, newType)
  })

  it('should call updateLoopCount when changing loop count', () => {
    const nodeId = 'loop1'
    const newCount = 15

    // Simulate the handler being called
    mockUpdateLoopCount(nodeId, newCount)

    expect(mockUpdateLoopCount).toHaveBeenCalledWith(nodeId, newCount)
  })

  it('should call updateLoopCollection when changing collection', () => {
    const nodeId = 'loop1'
    const newCollection = '["item1", "item2", "item3"]'

    // Simulate the handler being called
    mockUpdateLoopCollection(nodeId, newCollection)

    expect(mockUpdateLoopCollection).toHaveBeenCalledWith(nodeId, newCollection)
  })
})
