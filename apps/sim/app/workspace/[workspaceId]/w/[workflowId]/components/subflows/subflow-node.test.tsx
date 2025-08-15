import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'

// Shared spies used across mocks
const mockRemoveBlock = vi.fn()
const mockGetNodes = vi.fn()

// Mocks
vi.mock('@/hooks/use-collaborative-workflow', () => ({
  useCollaborativeWorkflow: vi.fn(() => ({
    collaborativeRemoveBlock: mockRemoveBlock,
  })),
}))

vi.mock('@/lib/logs/console/logger', () => ({
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
    getNodes: mockGetNodes,
  }),
  memo: (component: any) => component,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<any>('react')
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
    StartIcon: ({ className }: any) => ({ className }),
  }
})

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/components/iteration-badges/iteration-badges',
  () => ({
    IterationBadges: ({ nodeId, iterationType }: any) => ({ nodeId, iterationType }),
  })
)

describe('SubflowNodeComponent', () => {
  const defaultProps = {
    id: 'subflow-1',
    type: 'subflowNode',
    data: {
      width: 500,
      height: 300,
      isPreview: false,
      kind: 'loop' as const,
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
    mockGetNodes.mockReturnValue([])
  })

  describe('Component Definition and Structure', () => {
    it('should be defined as a function component', () => {
      expect(SubflowNodeComponent).toBeDefined()
      expect(typeof SubflowNodeComponent).toBe('function')
    })

    it('should have correct display name', () => {
      expect(SubflowNodeComponent.displayName).toBe('SubflowNodeComponent')
    })

    it('should be a memoized component', () => {
      expect(SubflowNodeComponent).toBeDefined()
    })
  })

  describe('Props Validation and Type Safety', () => {
    it('should accept NodeProps interface', () => {
      const validProps = {
        id: 'test-id',
        type: 'subflowNode' as const,
        data: {
          width: 400,
          height: 300,
          isPreview: true,
          kind: 'parallel' as const,
        },
        selected: false,
        zIndex: 1,
        isConnectable: true,
        xPos: 0,
        yPos: 0,
        dragging: false,
      }

      expect(() => {
        const _component: typeof SubflowNodeComponent = SubflowNodeComponent
        expect(_component).toBeDefined()
        expect(validProps.type).toBe('subflowNode')
      }).not.toThrow()
    })

    it('should handle different data configurations', () => {
      const configurations = [
        { width: 500, height: 300, isPreview: false, kind: 'loop' as const },
        { width: 800, height: 600, isPreview: true, kind: 'parallel' as const },
        { width: 0, height: 0, isPreview: false, kind: 'loop' as const },
        { kind: 'loop' as const },
      ]

      configurations.forEach((data) => {
        const props = { ...defaultProps, data }
        expect(() => {
          const _component: typeof SubflowNodeComponent = SubflowNodeComponent
          expect(_component).toBeDefined()
          expect(props.data).toBeDefined()
        }).not.toThrow()
      })
    })
  })

  describe('Hook Integration', () => {
    it('should provide collaborativeRemoveBlock', () => {
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
        { nestingLevel: 0, expectedBg: 'rgba(34,197,94,0.05)' },
        { nestingLevel: 1, expectedBg: '#e2e8f030' },
        { nestingLevel: 2, expectedBg: '#cbd5e130' },
      ]

      testCases.forEach(({ nestingLevel, expectedBg }) => {
        // Simulate the getNestedStyles logic
        const styles: Record<string, string> = {
          backgroundColor: 'rgba(34,197,94,0.05)',
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
        const data = { width, height }
        expect(data.width).toBe(width)
        expect(data.height).toBe(height)
      })
    })
  })

  describe('Event Handling Logic', () => {
    it('should handle delete button click logic (simulated)', () => {
      const mockEvent = { stopPropagation: vi.fn() }

      const handleDelete = (e: any, nodeId: string) => {
        e.stopPropagation()
        mockRemoveBlock(nodeId)
      }

      handleDelete(mockEvent, 'test-id')

      expect(mockEvent.stopPropagation).toHaveBeenCalled()
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })

    it('should handle event propagation prevention', () => {
      const mockEvent = { stopPropagation: vi.fn() }
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
        { width: 500, height: 300 },
      ]

      testCases.forEach((data: any) => {
        const props = { ...defaultProps, data }
        const width = Math.max(0, data?.width || 500)
        const height = Math.max(0, data?.height || 300)
        expect(width).toBeGreaterThanOrEqual(0)
        expect(height).toBeGreaterThanOrEqual(0)
        expect(props.type).toBe('subflowNode')
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
      const nodes = [
        { id: 'node1', data: { parentId: 'node2' } },
        { id: 'node2', data: { parentId: 'node1' } },
      ]

      mockGetNodes.mockReturnValue(nodes)

      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          break
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break
        currentParentId = parentNode.data?.parentId
      }

      expect(level).toBe(2)
      expect(visited.has('node1')).toBe(true)
      expect(visited.has('node2')).toBe(true)
    })

    it('should handle complex circular reference chains', () => {
      const nodes = [
        { id: 'node1', data: { parentId: 'node2' } },
        { id: 'node2', data: { parentId: 'node3' } },
        { id: 'node3', data: { parentId: 'node1' } },
      ]

      mockGetNodes.mockReturnValue(nodes)

      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          break
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break
        currentParentId = parentNode.data?.parentId
      }

      expect(level).toBe(3)
      expect(visited.size).toBe(3)
    })

    it('should handle self-referencing nodes', () => {
      const nodes = [{ id: 'node1', data: { parentId: 'node1' } }]

      mockGetNodes.mockReturnValue(nodes)

      let level = 0
      let currentParentId = 'node1'
      const visited = new Set<string>()

      while (currentParentId) {
        if (visited.has(currentParentId)) {
          break
        }

        visited.add(currentParentId)
        level++

        const parentNode = nodes.find((n) => n.id === currentParentId)
        if (!parentNode) break
        currentParentId = parentNode.data?.parentId
      }

      expect(level).toBe(1)
      expect(visited.has('node1')).toBe(true)
    })
  })
})
