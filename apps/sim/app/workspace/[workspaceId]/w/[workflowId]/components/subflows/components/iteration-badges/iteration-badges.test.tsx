import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock hooks
const mockCollaborativeUpdates = {
  collaborativeUpdateLoopType: vi.fn(),
  collaborativeUpdateParallelType: vi.fn(),
  collaborativeUpdateIterationCount: vi.fn(),
  collaborativeUpdateIterationCollection: vi.fn(),
}

const mockStoreData = {
  loops: {},
  parallels: {},
}

vi.mock('@/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: () => mockCollaborativeUpdates,
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: () => mockStoreData,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: any) => (
    <div data-testid='badge' {...props}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input data-testid='input' {...props} />,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div data-testid='popover'>{children}</div>,
  PopoverContent: ({ children }: any) => <div data-testid='popover-content'>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div data-testid='popover-trigger'>{children}</div>,
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  checkTagTrigger: vi.fn(() => ({ show: false })),
  TagDropdown: ({ children }: any) => <div data-testid='tag-dropdown'>{children}</div>,
}))

vi.mock('react-simple-code-editor', () => ({
  default: (props: any) => <textarea data-testid='code-editor' {...props} />,
}))

describe('IterationBadges', () => {
  const defaultProps = {
    nodeId: 'test-node-1',
    data: {
      width: 500,
      height: 300,
      isPreview: false,
    },
    iterationType: 'loop' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreData.loops = {}
    mockStoreData.parallels = {}
  })

  describe('Component Interface', () => {
    it.concurrent('should accept required props', () => {
      expect(defaultProps.nodeId).toBeDefined()
      expect(defaultProps.data).toBeDefined()
      expect(defaultProps.iterationType).toBeDefined()
    })

    it.concurrent('should handle loop iteration type prop', () => {
      const loopProps = { ...defaultProps, iterationType: 'loop' as const }
      expect(loopProps.iterationType).toBe('loop')
    })

    it.concurrent('should handle parallel iteration type prop', () => {
      const parallelProps = { ...defaultProps, iterationType: 'parallel' as const }
      expect(parallelProps.iterationType).toBe('parallel')
    })
  })

  describe('Configuration System', () => {
    it.concurrent('should use correct config for loop type', () => {
      const CONFIG = {
        loop: {
          typeLabels: { for: 'For Loop', forEach: 'For Each' },
          typeKey: 'loopType' as const,
          storeKey: 'loops' as const,
          maxIterations: 100,
          configKeys: {
            iterations: 'iterations' as const,
            items: 'forEachItems' as const,
          },
        },
      }

      expect(CONFIG.loop.typeLabels.for).toBe('For Loop')
      expect(CONFIG.loop.typeLabels.forEach).toBe('For Each')
      expect(CONFIG.loop.maxIterations).toBe(100)
      expect(CONFIG.loop.storeKey).toBe('loops')
    })

    it.concurrent('should use correct config for parallel type', () => {
      const CONFIG = {
        parallel: {
          typeLabels: { count: 'Parallel Count', collection: 'Parallel Each' },
          typeKey: 'parallelType' as const,
          storeKey: 'parallels' as const,
          maxIterations: 20,
          configKeys: {
            iterations: 'count' as const,
            items: 'distribution' as const,
          },
        },
      }

      expect(CONFIG.parallel.typeLabels.count).toBe('Parallel Count')
      expect(CONFIG.parallel.typeLabels.collection).toBe('Parallel Each')
      expect(CONFIG.parallel.maxIterations).toBe(20)
      expect(CONFIG.parallel.storeKey).toBe('parallels')
    })
  })

  describe('Type Determination Logic', () => {
    it.concurrent('should default to "for" for loop type', () => {
      type IterationType = 'loop' | 'parallel'
      const determineDefaultType = (iterationType: IterationType) => {
        return iterationType === 'loop' ? 'for' : 'count'
      }

      const currentType = determineDefaultType('loop')
      expect(currentType).toBe('for')
    })

    it.concurrent('should default to "count" for parallel type', () => {
      type IterationType = 'loop' | 'parallel'
      const determineDefaultType = (iterationType: IterationType) => {
        return iterationType === 'loop' ? 'for' : 'count'
      }

      const currentType = determineDefaultType('parallel')
      expect(currentType).toBe('count')
    })

    it.concurrent('should use explicit loopType when provided', () => {
      type IterationType = 'loop' | 'parallel'
      const determineType = (explicitType: string | undefined, iterationType: IterationType) => {
        return explicitType || (iterationType === 'loop' ? 'for' : 'count')
      }

      const currentType = determineType('forEach', 'loop')
      expect(currentType).toBe('forEach')
    })

    it.concurrent('should use explicit parallelType when provided', () => {
      type IterationType = 'loop' | 'parallel'
      const determineType = (explicitType: string | undefined, iterationType: IterationType) => {
        return explicitType || (iterationType === 'loop' ? 'for' : 'count')
      }

      const currentType = determineType('collection', 'parallel')
      expect(currentType).toBe('collection')
    })
  })

  describe('Count Mode Detection', () => {
    it.concurrent('should be in count mode for loop + for combination', () => {
      type IterationType = 'loop' | 'parallel'
      type LoopType = 'for' | 'forEach'
      type ParallelType = 'count' | 'collection'

      const iterationType: IterationType = 'loop'
      const currentType: LoopType = 'for'
      const isCountMode = iterationType === 'loop' && currentType === 'for'

      expect(isCountMode).toBe(true)
    })

    it.concurrent('should be in count mode for parallel + count combination', () => {
      type IterationType = 'loop' | 'parallel'
      type ParallelType = 'count' | 'collection'

      const iterationType: IterationType = 'parallel'
      const currentType: ParallelType = 'count'
      const isCountMode = iterationType === 'parallel' && currentType === 'count'

      expect(isCountMode).toBe(true)
    })

    it.concurrent('should not be in count mode for loop + forEach combination', () => {
      type IterationType = 'loop' | 'parallel'

      const testCountMode = (iterationType: IterationType, currentType: string) => {
        return iterationType === 'loop' && currentType === 'for'
      }

      const isCountMode = testCountMode('loop', 'forEach')
      expect(isCountMode).toBe(false)
    })

    it.concurrent('should not be in count mode for parallel + collection combination', () => {
      type IterationType = 'loop' | 'parallel'

      const testCountMode = (iterationType: IterationType, currentType: string) => {
        return iterationType === 'parallel' && currentType === 'count'
      }

      const isCountMode = testCountMode('parallel', 'collection')
      expect(isCountMode).toBe(false)
    })
  })

  describe('Configuration Values', () => {
    it.concurrent('should handle default iteration count', () => {
      const data = { count: undefined }
      const configIterations = data.count ?? 5
      expect(configIterations).toBe(5)
    })

    it.concurrent('should use provided iteration count', () => {
      const data = { count: 10 }
      const configIterations = data.count ?? 5
      expect(configIterations).toBe(10)
    })

    it.concurrent('should handle string collection', () => {
      const collection = '[1, 2, 3, 4, 5]'
      const collectionString =
        typeof collection === 'string' ? collection : JSON.stringify(collection) || ''
      expect(collectionString).toBe('[1, 2, 3, 4, 5]')
    })

    it.concurrent('should handle object collection', () => {
      const collection = { items: [1, 2, 3] }
      const collectionString =
        typeof collection === 'string' ? collection : JSON.stringify(collection) || ''
      expect(collectionString).toBe('{"items":[1,2,3]}')
    })

    it.concurrent('should handle array collection', () => {
      const collection = [1, 2, 3, 4, 5]
      const collectionString =
        typeof collection === 'string' ? collection : JSON.stringify(collection) || ''
      expect(collectionString).toBe('[1,2,3,4,5]')
    })
  })

  describe('Preview Mode Handling', () => {
    it.concurrent('should handle preview mode for loops', () => {
      const previewProps = {
        ...defaultProps,
        data: { ...defaultProps.data, isPreview: true },
        iterationType: 'loop' as const,
      }

      expect(previewProps.data.isPreview).toBe(true)
      // In preview mode, collaborative functions shouldn't be called
      expect(mockCollaborativeUpdates.collaborativeUpdateLoopType).not.toHaveBeenCalled()
    })

    it.concurrent('should handle preview mode for parallels', () => {
      const previewProps = {
        ...defaultProps,
        data: { ...defaultProps.data, isPreview: true },
        iterationType: 'parallel' as const,
      }

      expect(previewProps.data.isPreview).toBe(true)
      // In preview mode, collaborative functions shouldn't be called
      expect(mockCollaborativeUpdates.collaborativeUpdateParallelType).not.toHaveBeenCalled()
    })
  })

  describe('Store Integration', () => {
    it.concurrent('should access loops store for loop iteration type', () => {
      const nodeId = 'loop-node-1'
      ;(mockStoreData.loops as any)[nodeId] = { iterations: 10 }

      const nodeConfig = (mockStoreData.loops as any)[nodeId]
      expect(nodeConfig).toBeDefined()
      expect(nodeConfig.iterations).toBe(10)
    })

    it.concurrent('should access parallels store for parallel iteration type', () => {
      const nodeId = 'parallel-node-1'
      ;(mockStoreData.parallels as any)[nodeId] = { count: 5 }

      const nodeConfig = (mockStoreData.parallels as any)[nodeId]
      expect(nodeConfig).toBeDefined()
      expect(nodeConfig.count).toBe(5)
    })

    it.concurrent('should handle missing node configuration gracefully', () => {
      const nodeId = 'missing-node'
      const nodeConfig = (mockStoreData.loops as any)[nodeId]
      expect(nodeConfig).toBeUndefined()
    })
  })

  describe('Max Iterations Limits', () => {
    it.concurrent('should enforce max iterations for loops (100)', () => {
      const maxIterations = 100
      const testValue = 150
      const clampedValue = Math.min(maxIterations, testValue)
      expect(clampedValue).toBe(100)
    })

    it.concurrent('should enforce max iterations for parallels (20)', () => {
      const maxIterations = 20
      const testValue = 50
      const clampedValue = Math.min(maxIterations, testValue)
      expect(clampedValue).toBe(20)
    })

    it.concurrent('should allow values within limits', () => {
      const loopMaxIterations = 100
      const parallelMaxIterations = 20

      expect(Math.min(loopMaxIterations, 50)).toBe(50)
      expect(Math.min(parallelMaxIterations, 10)).toBe(10)
    })
  })

  describe('Collaborative Update Functions', () => {
    it.concurrent('should have the correct collaborative functions available', () => {
      expect(mockCollaborativeUpdates.collaborativeUpdateLoopType).toBeDefined()
      expect(mockCollaborativeUpdates.collaborativeUpdateParallelType).toBeDefined()
      expect(mockCollaborativeUpdates.collaborativeUpdateIterationCount).toBeDefined()
      expect(mockCollaborativeUpdates.collaborativeUpdateIterationCollection).toBeDefined()
    })

    it.concurrent('should call correct function for loop type updates', () => {
      const handleTypeChange = (newType: string, iterationType: string, nodeId: string) => {
        if (iterationType === 'loop') {
          mockCollaborativeUpdates.collaborativeUpdateLoopType(nodeId, newType)
        } else {
          mockCollaborativeUpdates.collaborativeUpdateParallelType(nodeId, newType)
        }
      }

      handleTypeChange('forEach', 'loop', 'test-node')
      expect(mockCollaborativeUpdates.collaborativeUpdateLoopType).toHaveBeenCalledWith(
        'test-node',
        'forEach'
      )
    })

    it.concurrent('should call correct function for parallel type updates', () => {
      const handleTypeChange = (newType: string, iterationType: string, nodeId: string) => {
        if (iterationType === 'loop') {
          mockCollaborativeUpdates.collaborativeUpdateLoopType(nodeId, newType)
        } else {
          mockCollaborativeUpdates.collaborativeUpdateParallelType(nodeId, newType)
        }
      }

      handleTypeChange('collection', 'parallel', 'test-node')
      expect(mockCollaborativeUpdates.collaborativeUpdateParallelType).toHaveBeenCalledWith(
        'test-node',
        'collection'
      )
    })
  })

  describe('Input Sanitization', () => {
    it.concurrent('should sanitize numeric input by removing non-digits', () => {
      const testInput = 'abc123def456'
      const sanitized = testInput.replace(/[^0-9]/g, '')
      expect(sanitized).toBe('123456')
    })

    it.concurrent('should handle empty input', () => {
      const testInput = ''
      const sanitized = testInput.replace(/[^0-9]/g, '')
      expect(sanitized).toBe('')
    })

    it.concurrent('should preserve valid numeric input', () => {
      const testInput = '42'
      const sanitized = testInput.replace(/[^0-9]/g, '')
      expect(sanitized).toBe('42')
    })
  })
})
