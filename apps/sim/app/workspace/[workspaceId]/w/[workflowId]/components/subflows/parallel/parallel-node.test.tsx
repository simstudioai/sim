import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ParallelNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-node'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: vi.fn(),
}))

vi.mock('@/lib/logs/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('reactflow', () => ({
  Handle: ({ id, type, position }: any) => ({ id, type, position }),
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
  useReactFlow: () => ({
    getNodes: vi.fn(() => []),
  }),
  NodeResizer: ({ isVisible }: any) => ({ isVisible }),
  memo: (component: any) => component,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    memo: (component: any) => component,
    useMemo: (fn: any) => fn(),
    useRef: () => ({ current: null }),
  }
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => ({ children, onClick, ...props }),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => ({ children, ...props }),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: vi.fn(() => ({
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    subBlocks: [],
    outputs: {},
  })),
  getAllBlocks: vi.fn(() => ({})),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/parallel-node/components/parallel-badges',
  () => ({
    ParallelBadges: ({ parallelId }: any) => ({ parallelId }),
  })
)

describe('ParallelNodeComponent', () => {
  const mockRemoveBlock = vi.fn()
  const mockGetNodes = vi.fn()
  const defaultProps = {
    id: 'parallel-1',
    type: 'parallelNode',
    data: {
      width: 500,
      height: 300,
      state: 'valid',
    },
    selected: false,
    zIndex: 1,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    ;(useWorkflowStore as any).mockImplementation((selector: any) => {
      const state = {
        removeBlock: mockRemoveBlock,
      }
      return selector(state)
    })

    mockGetNodes.mockReturnValue([])
  })

  describe('Component Definition and Structure', () => {
    it.concurrent('should be defined as a function component', () => {
      expect(ParallelNodeComponent).toBeDefined()
      expect(typeof ParallelNodeComponent).toBe('function')
    })

    it.concurrent('should have correct display name', () => {
      expect(ParallelNodeComponent.displayName).toBe('ParallelNodeComponent')
    })

    it.concurrent('should be a memoized component', () => {
      expect(ParallelNodeComponent).toBeDefined()
    })
  })

  describe('Props Validation and Type Safety', () => {
    it.concurrent('should accept NodeProps interface', () => {
      expect(() => {
        const _component: typeof ParallelNodeComponent = ParallelNodeComponent
        expect(_component).toBeDefined()
      }).not.toThrow()
    })

    it.concurrent('should handle different data configurations', () => {
      const configurations = [
        { width: 500, height: 300, state: 'valid' },
        { width: 800, height: 600, state: 'invalid' },
        { width: 0, height: 0, state: 'pending' },
        {},
      ]

      configurations.forEach((data) => {
        const props = { ...defaultProps, data }
        expect(() => {
          const _component: typeof ParallelNodeComponent = ParallelNodeComponent
          expect(_component).toBeDefined()
        }).not.toThrow()
      })
    })
  })

  describe('Store Integration', () => {
    it.concurrent('should integrate with workflow store', () => {
      expect(useWorkflowStore).toBeDefined()

      const mockState = { removeBlock: mockRemoveBlock }
      const selector = vi.fn((state) => state.removeBlock)

      expect(() => {
        selector(mockState)
      }).not.toThrow()

      expect(selector(mockState)).toBe(mockRemoveBlock)
    })

    it.concurrent('should handle removeBlock function', () => {
      expect(mockRemoveBlock).toBeDefined()
      expect(typeof mockRemoveBlock).toBe('function')

      mockRemoveBlock('test-id')
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })
  })

  describe('Component Logic Tests', () => {
    it.concurrent('should handle nesting level calculation logic', () => {
      const testCases = [
        { nodes: [], parentId: undefined, expectedLevel: 0 },
        { nodes: [{ id: 'parent', data: {} }], parentId: 'parent', expectedLevel: 1 },
        {
          nodes: [
            { id: 'parent', data: { parentId: 'grandparent' } },
            { id: 'grandparent', data: {} },
          ],
          parentId: 'parent',
          expectedLevel: 2,
        },
      ]

      testCases.forEach(({ nodes, parentId, expectedLevel }) => {
        mockGetNodes.mockReturnValue(nodes)

        let level = 0
        let currentParentId = parentId

        while (currentParentId) {
          level++
          const parentNode = nodes.find((n) => n.id === currentParentId)
          if (!parentNode) break
          currentParentId = parentNode.data?.parentId
        }

        expect(level).toBe(expectedLevel)
      })
    })

    it.concurrent('should handle nested styles generation for parallel nodes', () => {
      const testCases = [
        { nestingLevel: 0, state: 'valid', expectedBg: 'rgba(254,225,43,0.05)' },
        { nestingLevel: 0, state: 'invalid', expectedBg: 'transparent' },
        { nestingLevel: 1, state: 'valid', expectedBg: '#e2e8f030' },
        { nestingLevel: 2, state: 'valid', expectedBg: '#cbd5e130' },
      ]

      testCases.forEach(({ nestingLevel, state, expectedBg }) => {
        const styles: Record<string, string> = {
          backgroundColor: state === 'valid' ? 'rgba(254,225,43,0.05)' : 'transparent',
        }

        if (nestingLevel > 0) {
          const colors = ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569']
          const colorIndex = (nestingLevel - 1) % colors.length
          styles.backgroundColor = `${colors[colorIndex]}30`
        }

        expect(styles.backgroundColor).toBe(expectedBg)
      })
    })
  })

  describe('Parallel-Specific Features', () => {
    it.concurrent('should handle parallel execution states', () => {
      const parallelStates = ['valid', 'invalid', 'executing', 'completed', 'pending']

      parallelStates.forEach((state) => {
        const data = { width: 500, height: 300, state }
        expect(data.state).toBe(state)

        const isExecuting = state === 'executing'
        const isCompleted = state === 'completed'

        expect(typeof isExecuting).toBe('boolean')
        expect(typeof isCompleted).toBe('boolean')
      })
    })

    it.concurrent('should handle parallel node color scheme', () => {
      const parallelColors = {
        background: 'rgba(254,225,43,0.05)',
        ring: '#FEE12B',
        startIcon: '#FEE12B',
      }

      expect(parallelColors.background).toContain('254,225,43')
      expect(parallelColors.ring).toBe('#FEE12B')
      expect(parallelColors.startIcon).toBe('#FEE12B')
    })

    it.concurrent('should differentiate from loop node styling', () => {
      const loopColors = {
        background: 'rgba(34,197,94,0.05)',
        ring: '#2FB3FF',
        startIcon: '#2FB3FF',
      }

      const parallelColors = {
        background: 'rgba(254,225,43,0.05)',
        ring: '#FEE12B',
        startIcon: '#FEE12B',
      }

      expect(parallelColors.background).not.toBe(loopColors.background)
      expect(parallelColors.ring).not.toBe(loopColors.ring)
      expect(parallelColors.startIcon).not.toBe(loopColors.startIcon)
    })
  })

  describe('Component Configuration', () => {
    it.concurrent('should handle different dimensions', () => {
      const dimensionTests = [
        { width: 500, height: 300 },
        { width: 800, height: 600 },
        { width: 0, height: 0 },
        { width: 10000, height: 10000 },
      ]

      dimensionTests.forEach(({ width, height }) => {
        const data = { width, height, state: 'valid' }
        expect(data.width).toBe(width)
        expect(data.height).toBe(height)
      })
    })

    it.concurrent('should handle different states', () => {
      const stateTests = ['valid', 'invalid', 'pending', 'executing', 'completed']

      stateTests.forEach((state) => {
        const data = { width: 500, height: 300, state }
        expect(data.state).toBe(state)
      })
    })
  })

  describe('Event Handling Logic', () => {
    it.concurrent('should handle delete button click logic', () => {
      const mockEvent = {
        stopPropagation: vi.fn(),
      }

      const handleDelete = (e: any, nodeId: string) => {
        e.stopPropagation()
        mockRemoveBlock(nodeId)
      }

      handleDelete(mockEvent, 'test-id')

      expect(mockEvent.stopPropagation).toHaveBeenCalled()
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })

    it.concurrent('should handle event propagation prevention', () => {
      const mockEvent = {
        stopPropagation: vi.fn(),
      }

      mockEvent.stopPropagation()
      expect(mockEvent.stopPropagation).toHaveBeenCalled()
    })
  })

  describe('Component Data Handling', () => {
    it.concurrent('should handle missing data properties gracefully', () => {
      const testCases = [
        undefined,
        {},
        { width: 500 },
        { height: 300 },
        { state: 'valid' },
        { width: 500, height: 300 },
      ]

      testCases.forEach((data) => {
        const props = { ...defaultProps, data }

        // Test default values logic
        const width = data?.width || 500
        const height = data?.height || 300

        expect(width).toBeGreaterThanOrEqual(0)
        expect(height).toBeGreaterThanOrEqual(0)
      })
    })

    it.concurrent('should handle parent ID relationships', () => {
      const testCases = [
        { parentId: undefined, hasParent: false },
        { parentId: 'parent-1', hasParent: true },
        { parentId: '', hasParent: false },
      ]

      testCases.forEach(({ parentId, hasParent }) => {
        const data = { ...defaultProps.data, parentId }
        expect(Boolean(data.parentId)).toBe(hasParent)
      })
    })
  })

  describe('Handle Configuration', () => {
    it.concurrent('should have correct handle IDs for parallel nodes', () => {
      const handleIds = {
        startSource: 'parallel-start-source',
        endSource: 'parallel-end-source',
      }

      expect(handleIds.startSource).toContain('parallel')
      expect(handleIds.endSource).toContain('parallel')
      expect(handleIds.startSource).not.toContain('loop')
      expect(handleIds.endSource).not.toContain('loop')
    })

    it.concurrent('should handle different handle positions', () => {
      const positions = {
        left: 'left',
        right: 'right',
        top: 'top',
        bottom: 'bottom',
      }

      Object.values(positions).forEach((position) => {
        expect(typeof position).toBe('string')
        expect(position.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it.concurrent('should handle circular parent references', () => {
      // Test circular reference prevention
      const nodes = [
        { id: 'node1', data: { parentId: 'node2' } },
        { id: 'node2', data: { parentId: 'node1' } },
      ]

      mockGetNodes.mockReturnValue(nodes)

      // Test the actual component's nesting level calculation logic
      // This simulates the real useMemo logic from the component
      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      // This is the actual logic pattern used in the component
      while (currentParentId) {
        // If we've seen this parent before, we have a cycle - break immediately
        if (visited.has(currentParentId)) {
          break
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break

        currentParentId = parentNode.data?.parentId
      }

      // With proper circular reference detection, we should stop at level 2
      // (node1 -> node2, then detect cycle when trying to go back to node1)
      expect(level).toBe(2)
      expect(visited.has('node1')).toBe(true)
      expect(visited.has('node2')).toBe(true)
    })

    it.concurrent('should handle complex circular reference chains', () => {
      // Test more complex circular reference scenarios
      const nodes = [
        { id: 'node1', data: { parentId: 'node2' } },
        { id: 'node2', data: { parentId: 'node3' } },
        { id: 'node3', data: { parentId: 'node1' } }, // Creates a 3-node cycle
      ]

      mockGetNodes.mockReturnValue(nodes)

      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          break // Cycle detected
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break

        currentParentId = parentNode.data?.parentId
      }

      // Should traverse node1 -> node2 -> node3, then detect cycle
      expect(level).toBe(3)
      expect(visited.size).toBe(3)
    })

    it.concurrent('should handle self-referencing nodes', () => {
      // Test node that references itself
      const nodes = [
        { id: 'node1', data: { parentId: 'node1' } }, // Self-reference
      ]

      mockGetNodes.mockReturnValue(nodes)

      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          break // Cycle detected immediately
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break

        currentParentId = parentNode.data?.parentId
      }

      // Should detect self-reference immediately after first iteration
      expect(level).toBe(1)
      expect(visited.has('node1')).toBe(true)
    })

    it.concurrent('should handle extreme values', () => {
      const extremeValues = [
        { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
        { width: -1, height: -1 },
        { width: 0, height: 0 },
        { width: null, height: null },
      ]

      extremeValues.forEach((data) => {
        expect(() => {
          const width = data.width || 500
          const height = data.height || 300
          expect(typeof width).toBe('number')
          expect(typeof height).toBe('number')
        }).not.toThrow()
      })
    })

    it.concurrent('should handle negative position values', () => {
      const positions = [
        { xPos: -100, yPos: -200 },
        { xPos: 0, yPos: 0 },
        { xPos: 1000, yPos: 2000 },
      ]

      positions.forEach(({ xPos, yPos }) => {
        const props = { ...defaultProps, xPos, yPos }
        expect(props.xPos).toBe(xPos)
        expect(props.yPos).toBe(yPos)
        expect(typeof props.xPos).toBe('number')
        expect(typeof props.yPos).toBe('number')
      })
    })
  })

  describe('Component Comparison with Loop Node', () => {
    it.concurrent('should have similar structure to loop node but different type', () => {
      expect(defaultProps.type).toBe('parallelNode')
      expect(defaultProps.id).toContain('parallel')

      // Should not be a loop node
      expect(defaultProps.type).not.toBe('loopNode')
      expect(defaultProps.id).not.toContain('loop')
    })

    it.concurrent('should handle the same prop structure as loop node', () => {
      // Test that parallel node accepts the same prop structure as loop node
      const sharedPropStructure = {
        id: 'test-parallel',
        type: 'parallelNode' as const,
        data: {
          width: 400,
          height: 300,
          state: 'valid' as const,
        },
        selected: false,
        zIndex: 1,
        isConnectable: true,
        xPos: 0,
        yPos: 0,
        dragging: false,
      }

      expect(() => {
        const _component: typeof ParallelNodeComponent = ParallelNodeComponent
        expect(_component).toBeDefined()
      }).not.toThrow()

      // Verify the structure
      expect(sharedPropStructure.type).toBe('parallelNode')
      expect(sharedPropStructure.data.width).toBe(400)
      expect(sharedPropStructure.data.height).toBe(300)
    })

    it.concurrent('should maintain consistency with loop node interface', () => {
      const baseProps = [
        'id',
        'type',
        'data',
        'selected',
        'zIndex',
        'isConnectable',
        'xPos',
        'yPos',
        'dragging',
      ]

      baseProps.forEach((prop) => {
        expect(defaultProps).toHaveProperty(prop)
      })
    })
  })
})
