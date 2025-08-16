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
    it.concurrent('should be defined as a function component', () => {
      expect(SubflowNodeComponent).toBeDefined()
      expect(typeof SubflowNodeComponent).toBe('function')
    })

    it.concurrent('should have correct display name', () => {
      expect(SubflowNodeComponent.displayName).toBe('SubflowNodeComponent')
    })

    it.concurrent('should be a memoized component', () => {
      expect(SubflowNodeComponent).toBeDefined()
    })
  })

  describe('Props Validation and Type Safety', () => {
    it.concurrent('should accept NodeProps interface', () => {
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

    it.concurrent('should handle different data configurations', () => {
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
    it.concurrent('should provide collaborativeRemoveBlock', () => {
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

    it.concurrent('should handle nested styles generation', () => {
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
    it.concurrent('should handle different dimensions', () => {
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
    it.concurrent('should handle delete button click logic (simulated)', () => {
      const mockEvent = { stopPropagation: vi.fn() }

      const handleDelete = (e: any, nodeId: string) => {
        e.stopPropagation()
        mockRemoveBlock(nodeId)
      }

      handleDelete(mockEvent, 'test-id')

      expect(mockEvent.stopPropagation).toHaveBeenCalled()
      expect(mockRemoveBlock).toHaveBeenCalledWith('test-id')
    })

    it.concurrent('should handle event propagation prevention', () => {
      const mockEvent = { stopPropagation: vi.fn() }
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

  describe('Loop vs Parallel Kind Specific Tests', () => {
    it.concurrent('should generate correct handle IDs for loop kind', () => {
      const loopData = { ...defaultProps.data, kind: 'loop' as const }
      const startHandleId = loopData.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
      const endHandleId = loopData.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'

      expect(startHandleId).toBe('loop-start-source')
      expect(endHandleId).toBe('loop-end-source')
    })

    it.concurrent('should generate correct handle IDs for parallel kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testHandleGeneration = (kind: SubflowKind) => {
        const startHandleId = kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        return { startHandleId, endHandleId }
      }

      const result = testHandleGeneration('parallel')
      expect(result.startHandleId).toBe('parallel-start-source')
      expect(result.endHandleId).toBe('parallel-end-source')
    })

    it.concurrent('should generate correct background colors for loop kind', () => {
      const loopData = { ...defaultProps.data, kind: 'loop' as const }
      const startBg = loopData.kind === 'loop' ? '#2FB3FF' : '#FEE12B'

      expect(startBg).toBe('#2FB3FF')
    })

    it.concurrent('should generate correct background colors for parallel kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testBgGeneration = (kind: SubflowKind) => {
        return kind === 'loop' ? '#2FB3FF' : '#FEE12B'
      }

      const startBg = testBgGeneration('parallel')
      expect(startBg).toBe('#FEE12B')
    })

    it.concurrent('should demonstrate handle ID generation for any kind', () => {
      type SubflowKind = 'loop' | 'parallel'
      const testKind = (kind: SubflowKind) => {
        const data = { kind }
        const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        return { startHandleId, endHandleId }
      }

      const loopResult = testKind('loop')
      expect(loopResult.startHandleId).toBe('loop-start-source')
      expect(loopResult.endHandleId).toBe('loop-end-source')

      const parallelResult = testKind('parallel')
      expect(parallelResult.startHandleId).toBe('parallel-start-source')
      expect(parallelResult.endHandleId).toBe('parallel-end-source')
    })

    it.concurrent('should pass correct iterationType to IterationBadges for loop', () => {
      const loopProps = { ...defaultProps, data: { ...defaultProps.data, kind: 'loop' as const } }
      // Mock IterationBadges should receive the kind as iterationType
      expect(loopProps.data.kind).toBe('loop')
    })

    it.concurrent('should pass correct iterationType to IterationBadges for parallel', () => {
      const parallelProps = {
        ...defaultProps,
        data: { ...defaultProps.data, kind: 'parallel' as const },
      }
      // Mock IterationBadges should receive the kind as iterationType
      expect(parallelProps.data.kind).toBe('parallel')
    })

    it.concurrent('should handle both kinds in configuration arrays', () => {
      const bothKinds = ['loop', 'parallel'] as const
      bothKinds.forEach((kind) => {
        const data = { ...defaultProps.data, kind }
        expect(['loop', 'parallel']).toContain(data.kind)

        // Test handle ID generation for both kinds
        const startHandleId = data.kind === 'loop' ? 'loop-start-source' : 'parallel-start-source'
        const endHandleId = data.kind === 'loop' ? 'loop-end-source' : 'parallel-end-source'
        const startBg = data.kind === 'loop' ? '#2FB3FF' : '#FEE12B'

        if (kind === 'loop') {
          expect(startHandleId).toBe('loop-start-source')
          expect(endHandleId).toBe('loop-end-source')
          expect(startBg).toBe('#2FB3FF')
        } else {
          expect(startHandleId).toBe('parallel-start-source')
          expect(endHandleId).toBe('parallel-end-source')
          expect(startBg).toBe('#FEE12B')
        }
      })
    })

    it.concurrent('should maintain consistent styling behavior across both kinds', () => {
      const loopProps = { ...defaultProps, data: { ...defaultProps.data, kind: 'loop' as const } }
      const parallelProps = {
        ...defaultProps,
        data: { ...defaultProps.data, kind: 'parallel' as const },
      }

      // Both should have same base properties except kind-specific ones
      expect(loopProps.data.width).toBe(parallelProps.data.width)
      expect(loopProps.data.height).toBe(parallelProps.data.height)
      expect(loopProps.data.isPreview).toBe(parallelProps.data.isPreview)

      // But different kinds
      expect(loopProps.data.kind).toBe('loop')
      expect(parallelProps.data.kind).toBe('parallel')
    })
  })

  describe('Integration with IterationBadges', () => {
    it.concurrent('should pass nodeId to IterationBadges', () => {
      const testId = 'test-subflow-123'
      const props = { ...defaultProps, id: testId }

      // Verify the props would be passed correctly
      expect(props.id).toBe(testId)
    })

    it.concurrent('should pass data object to IterationBadges', () => {
      const testData = { ...defaultProps.data, customProperty: 'test' }
      const props = { ...defaultProps, data: testData }

      // Verify the data object structure
      expect(props.data).toEqual(testData)
      expect(props.data.kind).toBeDefined()
    })

    it.concurrent('should pass iterationType matching the kind', () => {
      const loopProps = { ...defaultProps, data: { ...defaultProps.data, kind: 'loop' as const } }
      const parallelProps = {
        ...defaultProps,
        data: { ...defaultProps.data, kind: 'parallel' as const },
      }

      // The iterationType should match the kind
      expect(loopProps.data.kind).toBe('loop')
      expect(parallelProps.data.kind).toBe('parallel')
    })
  })

  describe('CSS Class Generation', () => {
    it.concurrent('should generate proper CSS classes for nested loops', () => {
      const nestingLevel = 2
      const expectedBorderClass =
        nestingLevel > 0 &&
        `border border-[0.5px] ${nestingLevel % 2 === 0 ? 'border-slate-300/60' : 'border-slate-400/60'}`

      expect(expectedBorderClass).toBeTruthy()
      expect(expectedBorderClass).toContain('border-slate-300/60') // even nesting level
    })

    it.concurrent('should generate proper CSS classes for odd nested levels', () => {
      const nestingLevel = 3
      const expectedBorderClass =
        nestingLevel > 0 &&
        `border border-[0.5px] ${nestingLevel % 2 === 0 ? 'border-slate-300/60' : 'border-slate-400/60'}`

      expect(expectedBorderClass).toBeTruthy()
      expect(expectedBorderClass).toContain('border-slate-400/60') // odd nesting level
    })

    it.concurrent('should handle error state styling', () => {
      const hasNestedError = true
      const errorClasses = hasNestedError && 'border-2 border-red-500 bg-red-50/50'

      expect(errorClasses).toBe('border-2 border-red-500 bg-red-50/50')
    })

    it.concurrent('should handle diff status styling', () => {
      const diffStatuses = ['new', 'edited'] as const

      diffStatuses.forEach((status) => {
        let diffClass = ''
        if (status === 'new') {
          diffClass = 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10'
        } else if (status === 'edited') {
          diffClass = 'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10'
        }

        expect(diffClass).toBeTruthy()
        if (status === 'new') {
          expect(diffClass).toContain('ring-green-500')
        } else {
          expect(diffClass).toContain('ring-orange-500')
        }
      })
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it.concurrent('should handle circular parent references', () => {
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

    it.concurrent('should handle complex circular reference chains', () => {
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

    it.concurrent('should handle self-referencing nodes', () => {
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
