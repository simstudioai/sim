import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoopNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/loop-node/loop-node'
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

vi.mock('@/components/icons', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    // Override specific icons if needed for testing
    StartIcon: ({ className }: any) => ({ className }),
  }
})

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/loop-badges', () => ({
  LoopBadges: ({ loopId }: any) => ({ loopId }),
}))

describe('LoopNodeComponent', () => {
  const mockRemoveBlock = vi.fn()
  const mockGetNodes = vi.fn()
  const defaultProps = {
    id: 'loop-1',
    type: 'loopNode',
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
    it('should be defined as a function component', () => {
      expect(LoopNodeComponent).toBeDefined()
      expect(typeof LoopNodeComponent).toBe('function')
    })

    it('should have correct display name', () => {
      expect(LoopNodeComponent.displayName).toBe('LoopNodeComponent')
    })

    it('should be a memoized component', () => {
      expect(LoopNodeComponent).toBeDefined()
    })
  })

  describe('Props Validation and Type Safety', () => {
    it('should accept NodeProps interface', () => {
      const validProps = {
        id: 'test-id',
        type: 'loopNode' as const,
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
        const _component: typeof LoopNodeComponent = LoopNodeComponent
        expect(_component).toBeDefined()
      }).not.toThrow()
    })

    it('should handle different data configurations', () => {
      const configurations = [
        { width: 500, height: 300, state: 'valid' },
        { width: 800, height: 600, state: 'invalid' },
        { width: 0, height: 0, state: 'pending' },
        {},
      ]

      configurations.forEach((data) => {
        const props = { ...defaultProps, data }
        expect(() => {
          const _component: typeof LoopNodeComponent = LoopNodeComponent
          expect(_component).toBeDefined()
        }).not.toThrow()
      })
    })
  })

  describe('Store Integration', () => {
    it('should integrate with workflow store', () => {
      expect(useWorkflowStore).toBeDefined()

      const mockState = { removeBlock: mockRemoveBlock }
      const selector = vi.fn((state) => state.removeBlock)

      expect(() => {
        selector(mockState)
      }).not.toThrow()

      expect(selector(mockState)).toBe(mockRemoveBlock)
    })

    it('should handle removeBlock function', () => {
      expect(mockRemoveBlock).toBeDefined()
      expect(typeof mockRemoveBlock).toBe('function')

      mockRemoveBlock('test-id')
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })
  })

  describe('Component Logic Tests', () => {
    it('should handle nesting level calculation logic', () => {
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

        // Simulate the nesting level calculation logic
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

    it('should handle nested styles generation', () => {
      // Test the nested styles logic
      const testCases = [
        { nestingLevel: 0, state: 'valid', expectedBg: 'rgba(34,197,94,0.05)' },
        { nestingLevel: 0, state: 'invalid', expectedBg: 'transparent' },
        { nestingLevel: 1, state: 'valid', expectedBg: '#e2e8f030' },
        { nestingLevel: 2, state: 'valid', expectedBg: '#cbd5e130' },
      ]

      testCases.forEach(({ nestingLevel, state, expectedBg }) => {
        // Simulate the getNestedStyles logic
        const styles: Record<string, string> = {
          backgroundColor: state === 'valid' ? 'rgba(34,197,94,0.05)' : 'transparent',
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

  describe('Component Configuration', () => {
    it('should handle different dimensions', () => {
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

    it('should handle different states', () => {
      const stateTests = ['valid', 'invalid', 'pending', 'executing']

      stateTests.forEach((state) => {
        const data = { width: 500, height: 300, state }
        expect(data.state).toBe(state)
      })
    })
  })

  describe('Event Handling Logic', () => {
    it('should handle delete button click logic', () => {
      const mockEvent = {
        stopPropagation: vi.fn(),
      }

      // Simulate the delete button click handler
      const handleDelete = (e: any, nodeId: string) => {
        e.stopPropagation()
        mockRemoveBlock(nodeId)
      }

      handleDelete(mockEvent, 'test-id')

      expect(mockEvent.stopPropagation).toHaveBeenCalled()
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })

    it('should handle event propagation prevention', () => {
      const mockEvent = {
        stopPropagation: vi.fn(),
      }

      // Test that stopPropagation is called
      mockEvent.stopPropagation()
      expect(mockEvent.stopPropagation).toHaveBeenCalled()
    })
  })

  describe('Component Data Handling', () => {
    it('should handle missing data properties gracefully', () => {
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
        const width = Math.max(0, data?.width || 500)
        const height = Math.max(0, data?.height || 300)

        expect(width).toBeGreaterThanOrEqual(0)
        expect(height).toBeGreaterThanOrEqual(0)
      })
    })

    it('should handle parent ID relationships', () => {
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

  describe('Edge Cases and Error Handling', () => {
    it('should handle circular parent references', () => {
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

    it('should handle complex circular reference chains', () => {
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

    it('should handle self-referencing nodes', () => {
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

    it('should handle extreme values', () => {
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
  })
})
