/**
 * Tests for workflow change detection comparison logic
 */
import {
  createBlock as createTestBlock,
  createWorkflowState as createTestWorkflowState,
} from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  containerConfigFields,
  generateWorkflowDiffSummary,
  hasWorkflowChanged,
  omitPresentationChanges,
  type WorkflowDiffSummary,
} from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Type helper for converting test workflow state to app workflow state.
 */
function asAppState<T>(state: T): WorkflowState {
  return state as unknown as WorkflowState
}

/**
 * Helper to create a minimal valid workflow state using @sim/testing factory.
 */
function createWorkflowState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return asAppState(createTestWorkflowState(overrides as any))
}

/**
 * Helper to create a block with common fields using @sim/testing factory.
 */
function createBlock(id: string, overrides: Record<string, any> = {}): any {
  return createTestBlock({
    id,
    name: overrides.name ?? `Block ${id}`,
    type: overrides.type ?? 'agent',
    position: overrides.position ?? { x: 100, y: 100 },
    subBlocks: overrides.subBlocks ?? {},
    outputs: overrides.outputs ?? {},
    enabled: overrides.enabled ?? true,
    horizontalHandles: overrides.horizontalHandles ?? true,
    advancedMode: overrides.advancedMode ?? false,
    height: overrides.height ?? 200,
    ...overrides,
  })
}

describe('hasWorkflowChanged', () => {
  it('distinguishes nested JSON null from an omitted operation argument', () => {
    const state = (value: unknown) =>
      createWorkflowState({
        blocks: {
          mcp: createBlock('mcp', {
            type: 'mcp',
            subBlocks: {
              arguments: { id: 'arguments', type: 'mcp-dynamic-args', value },
            },
          }),
        },
      })
    const base = state({ patch: { owner: null, active: true } })
    const target = state({ patch: { active: true } })
    expect(hasWorkflowChanged(target, base)).toBe(true)
    expect(hasWorkflowChanged(base, target)).toBe(true)
    expect(hasWorkflowChanged(base, state({ patch: { active: true, owner: null } }))).toBe(false)
  })

  describe('Basic Cases', () => {
    it.concurrent('should return true when deployedState is null', () => {
      const currentState = createWorkflowState()
      expect(hasWorkflowChanged(currentState, null)).toBe(true)
    })

    it.concurrent('should return false for identical states with blocks', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { subBlocks: { prompt: { value: 'Hello' } } }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { subBlocks: { prompt: { value: 'Hello' } } }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Position and Layout Changes (Should Not Trigger Change)', () => {
    it.concurrent('should ignore position changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { position: { x: 0, y: 0 } }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { position: { x: 500, y: 500 } }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore multiple visual-only changes combined', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            position: { x: 0, y: 0 },
            layout: { measuredWidth: 100, measuredHeight: 200 },
            height: 100,
            data: { width: 100, height: 200, name: 'test' },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            position: { x: 999, y: 999 },
            layout: { measuredWidth: 999, measuredHeight: 999 },
            height: 999,
            data: { width: 999, height: 999, name: 'test' },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Edge Changes', () => {
    it.concurrent('should detect added edges', () => {
      const state1 = createWorkflowState({ edges: [] })
      const state2 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    /**
     * The live side collapses a falsy handle to nothing (`loadWorkflowFromNormalizedTables`
     * runs it through the canonicalizer), while the server diffs that against the deployment
     * version's raw jsonb, which does not. An edge persisted with `sourceHandle: ''` would be
     * present on one side and absent on the other — counted as removed and re-added, asking
     * every such workflow to redeploy for nothing.
     */
    it.concurrent('treats an empty-string handle as no handle', () => {
      const empty = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: '', target: 'block2' }],
      })
      const absent = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
      })
      expect(hasWorkflowChanged(empty, absent)).toBe(false)
    })

    it.concurrent('treats a side-anchored source handle as its canonical id', () => {
      const sideAnchored = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'source-right', target: 'block2' }],
      })
      const canonical = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'source', target: 'block2' }],
      })
      expect(hasWorkflowChanged(sideAnchored, canonical)).toBe(false)
    })

    it.concurrent('still tells two real ports apart', () => {
      const source = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'source', target: 'block2' }],
      })
      const error = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'error', target: 'block2' }],
      })
      expect(hasWorkflowChanged(source, error)).toBe(true)
    })

    it.concurrent('should ignore edge ID changes', () => {
      const state1 = createWorkflowState({
        edges: [{ id: 'edge-old', source: 'block1', target: 'block2' }],
      })
      const state2 = createWorkflowState({
        edges: [{ id: 'edge-new', source: 'block1', target: 'block2' }],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore edge order differences', () => {
      const state1 = createWorkflowState({
        edges: [
          { id: 'edge1', source: 'a', target: 'b' },
          { id: 'edge2', source: 'b', target: 'c' },
          { id: 'edge3', source: 'c', target: 'd' },
        ],
      })
      const state2 = createWorkflowState({
        edges: [
          { id: 'edge3', source: 'c', target: 'd' },
          { id: 'edge1', source: 'a', target: 'b' },
          { id: 'edge2', source: 'b', target: 'c' },
        ],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore non-functional edge properties', () => {
      const state1 = createWorkflowState({
        edges: [
          {
            id: 'edge1',
            source: 'block1',
            target: 'block2',
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'red' },
          },
        ],
      })
      const state2 = createWorkflowState({
        edges: [
          {
            id: 'edge1',
            source: 'block1',
            target: 'block2',
            type: 'bezier',
            animated: false,
            style: { stroke: 'blue' },
          },
        ],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Block Changes', () => {
    it.concurrent('should detect added blocks', () => {
      const state1 = createWorkflowState({ blocks: {} })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should not detect locked/unlocked toggle as a workflow change', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: false }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: true }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  /**
   * The flag drives the error port, and the deploy badge is what tells a user the
   * port they just switched on is not live yet.
   */
  describe('Error Output Flag', () => {
    const withErrorFlag = (errorEnabled: boolean) =>
      createWorkflowState({
        blocks: { block1: { ...createBlock('block1'), errorEnabled } },
      })

    it.concurrent('treats an unset flag as off', () => {
      const unset = createWorkflowState({ blocks: { block1: createBlock('block1') } })
      expect(hasWorkflowChanged(unset, withErrorFlag(false))).toBe(false)
      expect(hasWorkflowChanged(unset, withErrorFlag(true))).toBe(true)
    })

    /**
     * `setBlockErrorEnabled` leaves existing error edges in place, so a block can
     * hold `errorEnabled: false` with a connected error edge. Only the deployed
     * side is backfilled (`materializeDeploymentState`), so reading the flag alone
     * makes that block differ from itself, and redeploying cannot clear it — the
     * snapshot stores the live `false` that the next read backfills to `true`.
     */
    const withErrorEdge = (errorEnabled: boolean) =>
      createWorkflowState({
        blocks: {
          block1: { ...createBlock('block1'), errorEnabled },
          block2: createBlock('block2'),
        },
        edges: [
          { id: 'e1', source: 'block1', sourceHandle: 'error', target: 'block2' },
        ] as WorkflowState['edges'],
      })

    it.concurrent('treats a live error edge as the flag being on', () => {
      expect(hasWorkflowChanged(withErrorEdge(false), withErrorEdge(true))).toBe(false)
      expect(hasWorkflowChanged(withErrorEdge(true), withErrorEdge(false))).toBe(false)
    })

    it.concurrent('reports no modified block when only the backfilled flag differs', () => {
      const summary = generateWorkflowDiffSummary(withErrorEdge(false), withErrorEdge(true))
      expect(summary.hasChanges).toBe(false)
      expect(summary.modifiedBlocks).toEqual([])
    })

    it.concurrent('still detects the flag turning on when no error edge exists', () => {
      expect(hasWorkflowChanged(withErrorFlag(true), withErrorFlag(false))).toBe(true)
    })
  })

  describe('SubBlock Changes', () => {
    it.concurrent('should detect subBlock value changes (string)', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello world' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Goodbye world' } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should ignore subBlock type changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { type: 'short-input', value: 'Hello' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { type: 'long-input', value: 'Hello' } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle null/undefined subBlock values consistently', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: null } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: undefined } },
          }),
        },
      })
      // Both should be treated as null
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should detect empty string vs null difference', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: '' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: null } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })
  })

  describe('Tools SubBlock Special Handling', () => {
    it.concurrent('should ignore isExpanded field in tools', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  { id: 'tool1', name: 'Search', isExpanded: true },
                  { id: 'tool2', name: 'Calculator', isExpanded: false },
                ],
              },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  { id: 'tool1', name: 'Search', isExpanded: false },
                  { id: 'tool2', name: 'Calculator', isExpanded: true },
                ],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should detect actual tool changes despite isExpanded', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [{ id: 'tool1', name: 'Search', isExpanded: true }],
              },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  { id: 'tool1', name: 'Web Search', isExpanded: true }, // Changed name
                ],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })
  })

  describe('Block-based tool params (synthetic projection)', () => {
    const knowledgeTool = (kbId: string) => ({
      type: 'knowledge',
      toolId: 'knowledge_search',
      operation: 'search',
      params: { knowledgeBaseSelector: kbId },
      usageControl: 'auto',
    })

    it.concurrent('ignores synthetic tool subblocks present only in the current state', () => {
      const current = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: { value: [knowledgeTool('kb-123')] },
              'tools-tool-0-knowledgeBaseSelector': { value: 'kb-123' },
            },
          }),
        },
      })
      const deployed = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { tools: { value: [knowledgeTool('kb-123')] } },
          }),
        },
      })
      expect(hasWorkflowChanged(current, deployed)).toBe(false)
    })

    it.concurrent('treats a cleared tool param as a change (deselect symptom)', () => {
      const current = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { tools: { value: [knowledgeTool('')] } },
          }),
        },
      })
      const deployed = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { tools: { value: [knowledgeTool('kb-123')] } },
          }),
        },
      })
      expect(hasWorkflowChanged(current, deployed)).toBe(true)
    })

    it.concurrent('ignores synthetic subblocks for object-typed tool params', () => {
      const fileTool = {
        type: 'someservice',
        toolId: 'someservice_upload',
        operation: 'upload',
        params: { file: '{"name":"a.pdf"}' },
        usageControl: 'auto',
      }
      const current = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: { value: [fileTool] },
              'tools-tool-0-file': { value: { name: 'a.pdf' } },
            },
          }),
        },
      })
      const deployed = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { tools: { value: [fileTool] } },
          }),
        },
      })
      expect(hasWorkflowChanged(current, deployed)).toBe(false)
    })
  })

  describe('InputFormat SubBlock Special Handling', () => {
    it.concurrent('should ignore collapsed field but detect value changes in inputFormat', () => {
      // Only collapsed changes - should NOT detect as change
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [
                  { id: 'input1', name: 'Name', value: 'John', collapsed: true },
                  { id: 'input2', name: 'Age', value: 25, collapsed: false },
                ],
              },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [
                  { id: 'input1', name: 'Name', value: 'John', collapsed: false },
                  { id: 'input2', name: 'Age', value: 25, collapsed: true },
                ],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Table SubBlock Special Handling', () => {
    it.concurrent('should ignore non-deterministic table row ids', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ id: 'row-a', cells: { Key: 'Authorization', Value: 'Bearer x' } }],
              },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ id: 'row-b', cells: { Key: 'Authorization', Value: 'Bearer x' } }],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should treat a null table and a single blank starter row as equal', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: { id: 'headers', type: 'table', value: null },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ id: 'row-a', cells: { Key: '', Value: '' } }],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore a trailing blank row after a populated row', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ id: 'row-a', cells: { Key: 'Accept', Value: 'application/json' } }],
              },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [
                  { id: 'row-b', cells: { Key: 'Accept', Value: 'application/json' } },
                  { id: 'row-c', cells: { Key: '', Value: '' } },
                ],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should preserve flat rows without a cells object', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: { id: 'headers', type: 'table', value: null },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ name: 'FOO', value: 'bar' }],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect rows with a partially blank cell', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: { id: 'headers', type: 'table', value: null },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              headers: {
                id: 'headers',
                type: 'table',
                value: [{ id: 'row-a', cells: { Key: 'Accept', Value: '' } }],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })
  })

  describe('Loop Changes', () => {
    it.concurrent('should detect added loops', () => {
      const state1 = createWorkflowState({ loops: {} })
      const state2 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect forEach items changes', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'forEach',
            forEachItems: '<block.items>',
            iterations: 0,
          },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'forEach',
            forEachItems: '<other.items>',
            iterations: 0,
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect while condition changes', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'while',
            whileCondition: '<counter> < 10',
            iterations: 0,
          },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'while',
            whileCondition: '<counter> < 20',
            iterations: 0,
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should ignore irrelevant loop fields', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'for',
            iterations: 5,
            forEachItems: 'should-be-ignored',
            whileCondition: 'should-be-ignored',
          },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'for',
            iterations: 5,
            forEachItems: 'different-value',
            whileCondition: 'different-condition',
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Parallel Changes', () => {
    it.concurrent('should detect added parallels', () => {
      const state1 = createWorkflowState({ parallels: {} })
      const state2 = createWorkflowState({
        parallels: {
          parallel1: { id: 'parallel1', nodes: ['block1'], parallelType: 'count', count: 3 },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect parallel distribution changes', () => {
      const state1 = createWorkflowState({
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            parallelType: 'collection',
            distribution: '<block.items>',
          },
        },
      })
      const state2 = createWorkflowState({
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            parallelType: 'collection',
            distribution: '<other.items>',
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should ignore irrelevant parallel fields', () => {
      const state1 = createWorkflowState({
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            parallelType: 'count',
            count: 3,
            distribution: 'should-be-ignored',
          },
        },
      })
      const state2 = createWorkflowState({
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            parallelType: 'count',
            count: 3,
            distribution: 'different-value',
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Complex Scenarios', () => {
    it.concurrent('should handle empty vs missing blocks/edges/loops/parallels', () => {
      const state1 = createWorkflowState({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      })
      const state2 = createWorkflowState()

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle object key order differences in subBlock values', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              config: { value: { model: 'gpt-4', temperature: 0.7, maxTokens: 1000 } },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              config: { value: { maxTokens: 1000, model: 'gpt-4', temperature: 0.7 } },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it.concurrent('should handle undefined blocks in state', () => {
      const state1 = { edges: [], loops: {}, parallels: {} } as unknown as WorkflowState
      const state2 = createWorkflowState()

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should detect array order differences in subBlock values', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { items: { value: [1, 2, 3] } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { items: { value: [3, 2, 1] } },
          }),
        },
      })

      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })
  })

  describe('Tool Input Scenarios', () => {
    it.concurrent(
      'should not detect change when tool param is typed and cleared back to empty string',
      () => {
        // User adds a tool, types in a field, then clears it back to empty
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: {
                tools: {
                  value: [
                    {
                      type: 'search',
                      title: 'Search',
                      toolId: 'google_search',
                      params: { query: '' },
                      usageControl: 'auto',
                    },
                  ],
                },
              },
            }),
          },
        })

        // Current state after typing and clearing
        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: {
                tools: {
                  value: [
                    {
                      type: 'search',
                      title: 'Search',
                      toolId: 'google_search',
                      params: { query: '' },
                      usageControl: 'auto',
                    },
                  ],
                },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )

    it.concurrent('should detect change when tool usageControl changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    params: {},
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    params: {},
                    usageControl: 'force', // Changed from auto to force
                  },
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should handle empty string vs undefined in tool params', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    params: { query: undefined },
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    params: { query: '' }, // Empty string instead of undefined
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      // This IS a meaningful difference - undefined vs empty string
      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should handle missing params object vs empty params object', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    // No params property at all
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'search',
                    title: 'Search',
                    toolId: 'google_search',
                    params: {}, // Empty params object
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      // Missing property vs empty object IS a difference
      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should handle custom tool reference vs inline definition', () => {
      // New format: reference only
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'custom-tool',
                    customToolId: 'tool-123',
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      // Same tool, same ID
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'custom-tool',
                    customToolId: 'tool-123',
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })
  })

  describe('Input Format Field Scenarios', () => {
    it.concurrent('should detect change when inputFormat field is added or removed', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [{ id: 'field1', name: 'Name', type: 'string' }],
              },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [
                  { id: 'field1', name: 'Name', type: 'string' },
                  { id: 'field2', name: 'Email', type: 'string' }, // Added field
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })
  })

  describe('Prompt and Text Field Scenarios', () => {
    it.concurrent('should not detect change when text is typed and fully deleted', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: '' } },
          }),
        },
      })

      // User typed something, then selected all and deleted
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: '' } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should detect change for leading/trailing whitespace', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello' } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: ' Hello' } }, // Leading space
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })
  })

  describe('Variable Changes', () => {
    it.concurrent('should detect added variables', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {},
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should not detect change for undefined vs empty object variables', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: undefined,
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {},
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(false)
    })

    it.concurrent('should not detect change when variable key order differs', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
          var2: { id: 'var2', name: 'count', type: 'number', value: 42 },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var2: { id: 'var2', name: 'count', type: 'number', value: 42 },
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(false)
    })
  })

  describe('Trigger Config Normalization (False Positive Prevention)', () => {
    it.concurrent(
      'should not detect change when deployed has null fields but current has values from triggerConfig',
      () => {
        // Core scenario: deployed state has null individual fields, current state has
        // values populated from triggerConfig at runtime by populateTriggerFieldsFromConfig
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                signingSecret: { id: 'signingSecret', type: 'short-input', value: null },
                botToken: { id: 'botToken', type: 'short-input', value: null },
                triggerConfig: {
                  id: 'triggerConfig',
                  type: 'short-input',
                  value: { signingSecret: 'secret123', botToken: 'token456' },
                },
              },
            }),
          },
        })

        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                signingSecret: { id: 'signingSecret', type: 'short-input', value: 'secret123' },
                botToken: { id: 'botToken', type: 'short-input', value: 'token456' },
                triggerConfig: {
                  id: 'triggerConfig',
                  type: 'short-input',
                  value: { signingSecret: 'secret123', botToken: 'token456' },
                },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )

    it.concurrent(
      'should detect change when user edits a trigger field to a different value',
      () => {
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                signingSecret: { id: 'signingSecret', type: 'short-input', value: null },
                triggerConfig: {
                  id: 'triggerConfig',
                  type: 'short-input',
                  value: { signingSecret: 'old-secret' },
                },
              },
            }),
          },
        })

        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                signingSecret: { id: 'signingSecret', type: 'short-input', value: 'new-secret' },
                triggerConfig: {
                  id: 'triggerConfig',
                  type: 'short-input',
                  value: { signingSecret: 'old-secret' },
                },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
      }
    )

    it.concurrent('should not detect change when triggerId differs', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            type: 'starter',
            subBlocks: {
              model: { value: 'gpt-4' },
              triggerId: { value: null },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            type: 'starter',
            subBlocks: {
              model: { value: 'gpt-4' },
              triggerId: { value: 'slack_webhook' },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent(
      'should not detect change for namespaced system subBlock IDs like samplePayload_slack_webhook',
      () => {
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4' },
                samplePayload_slack_webhook: { value: 'old payload' },
                triggerInstructions_slack_webhook: { value: 'old instructions' },
              },
            }),
          },
        })

        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4' },
                samplePayload_slack_webhook: { value: 'new payload' },
                triggerInstructions_slack_webhook: { value: 'new instructions' },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )
  })

  describe('Trigger Runtime Metadata (Should Not Trigger Change)', () => {
    it.concurrent('should not detect change when all runtime metadata differs', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            type: 'starter',
            subBlocks: {
              model: { value: 'gpt-4' },
              webhookId: { value: null },
              triggerPath: { value: '' },
            },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            type: 'starter',
            subBlocks: {
              model: { value: 'gpt-4' },
              webhookId: { value: 'wh_123456' },
              triggerPath: { value: '/api/webhooks/abc123' },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent(
      'should detect change when actual config differs but runtime metadata also differs',
      () => {
        // Test that when a real config field changes along with runtime metadata,
        // the change is still detected. Using 'model' as the config field since
        // triggerConfig is now excluded from comparison (individual trigger fields
        // are compared separately).
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4' },
                webhookId: { value: null },
              },
            }),
          },
        })

        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4o' },
                webhookId: { value: 'wh_123456' },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
      }
    )

    it.concurrent(
      'should not detect change when triggerConfig differs (individual fields compared separately)',
      () => {
        // triggerConfig is excluded from comparison because:
        // 1. Individual trigger fields are stored as separate subblocks and compared individually
        // 2. The client populates triggerConfig with default values from trigger definitions,
        //    which aren't present in the deployed state, causing false positive change detection
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                triggerConfig: { value: { event: 'push' } },
              },
            }),
          },
        })

        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                triggerConfig: { value: { event: 'pull_request', extraField: true } },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )
  })

  describe('Variables (UI-only fields should not trigger change)', () => {
    it.concurrent('should not detect change when validationError differs', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
        },
      })
      ;(deployedState as any).variables = {
        var1: {
          id: 'var1',
          workflowId: 'workflow1',
          name: 'myVar',
          type: 'plain',
          value: 'test',
        },
      }

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
        },
      })
      ;(currentState as any).variables = {
        var1: {
          id: 'var1',
          workflowId: 'workflow1',
          name: 'myVar',
          type: 'plain',
          value: 'test',
          validationError: undefined,
        },
      }

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should not detect change when empty array vs empty object', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
        },
      })
      ;(deployedState as any).variables = []

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
        },
      })
      ;(currentState as any).variables = {}

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })
  })
})

describe('generateWorkflowDiffSummary', () => {
  describe('Basic Cases', () => {
    it.concurrent('should return hasChanges=true when previousState is null', () => {
      const currentState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const result = generateWorkflowDiffSummary(currentState, null)
      expect(result.hasChanges).toBe(true)
      expect(result.addedBlocks).toHaveLength(1)
      expect(result.addedBlocks[0].id).toBe('block1')
    })
  })

  describe('Block Changes', () => {
    it.concurrent('should detect modified blocks with field changes', () => {
      const previousState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { model: { id: 'model', type: 'dropdown', value: 'gpt-4o' } },
          }),
        },
      })
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { model: { id: 'model', type: 'dropdown', value: 'claude-sonnet' } },
          }),
        },
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.modifiedBlocks).toHaveLength(1)
      expect(result.modifiedBlocks[0].id).toBe('block1')
      expect(result.modifiedBlocks[0].changes.length).toBeGreaterThan(0)
      const modelChange = result.modifiedBlocks[0].changes.find((c) => c.field === 'model')
      expect(modelChange).toBeDefined()
      expect(modelChange?.oldValue).toBe('gpt-4o')
      expect(modelChange?.newValue).toBe('claude-sonnet')
    })
  })

  describe('Variable Changes', () => {
    it.concurrent('should detect modified variables', () => {
      const previousState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
        variables: { var1: { id: 'var1', name: 'test', type: 'string', value: 'hello' } },
      })
      const currentState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
        variables: { var1: { id: 'var1', name: 'test', type: 'string', value: 'world' } },
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.variableChanges.modified).toBe(1)
    })
  })

  describe('Consistency with hasWorkflowChanged', () => {
    it.concurrent('hasChanges should match hasWorkflowChanged result', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { id: 'prompt', type: 'long-input', value: 'new value' } },
          }),
        },
      })

      const diffResult = generateWorkflowDiffSummary(state2, state1)
      const hasChangedResult = hasWorkflowChanged(state2, state1)

      expect(diffResult.hasChanges).toBe(hasChangedResult)
    })
  })
})

describe('containerChanges', () => {
  function stateWithLoop(loop: Record<string, any>, blocks: Record<string, any> = {}) {
    return createWorkflowState({
      blocks: {
        loop1: createBlock('loop1', { type: 'loop', name: 'My Loop' }),
        ...blocks,
      },
      loops: { loop1: { id: 'loop1', enabled: true, ...loop } },
    })
  }

  it.concurrent('describes a reconfigured loop field by field, named after its block', () => {
    const previous = stateWithLoop({ nodes: ['a'], loopType: 'for', iterations: 2 })
    const current = stateWithLoop({ nodes: ['a'], loopType: 'for', iterations: 5 })

    const result = generateWorkflowDiffSummary(current, previous)

    expect(result.loopChanges).toEqual({ added: 0, removed: 0, modified: 1 })
    expect(result.containerChanges).toEqual([
      {
        id: 'loop1',
        kind: 'loop',
        name: 'My Loop',
        changes: [{ field: 'iterations', oldValue: 2, newValue: 5 }],
        nodesAdded: [],
        nodesRemoved: [],
      },
    ])
  })

  it.concurrent(
    'reports membership moves and a loop type switch with the fields that came and went',
    () => {
      const previous = stateWithLoop({ nodes: ['a', 'b'], loopType: 'for', iterations: 2 })
      const current = stateWithLoop({
        nodes: ['b', 'c'],
        loopType: 'forEach',
        forEachItems: '<start.items>',
        /* Stale count left behind by the switch; the normalized shape drops it for forEach. */
        iterations: 2,
      })

      const [change] = generateWorkflowDiffSummary(current, previous).containerChanges

      expect(change.nodesAdded).toEqual(['c'])
      expect(change.nodesRemoved).toEqual(['a'])
      expect(change.changes).toEqual([
        { field: 'loopType', oldValue: 'for', newValue: 'forEach' },
        { field: 'iterations', oldValue: 2, newValue: null },
        { field: 'forEachItems', oldValue: null, newValue: '<start.items>' },
      ])
    }
  )

  it.concurrent(
    'describes a parallel and skips containers that were added, removed or unchanged',
    () => {
      const previous = createWorkflowState({
        blocks: {
          par1: createBlock('par1', { type: 'parallel' }),
          parGone: createBlock('parGone', { type: 'parallel' }),
          loopSame: createBlock('loopSame', { type: 'loop' }),
        },
        parallels: {
          par1: { id: 'par1', nodes: ['x'], parallelType: 'count', count: 2, enabled: true },
          parGone: { id: 'parGone', nodes: [], parallelType: 'count', count: 1, enabled: true },
        },
        loops: { loopSame: { id: 'loopSame', nodes: ['y', 'z'], loopType: 'for', iterations: 1 } },
      })
      const current = createWorkflowState({
        blocks: {
          par1: createBlock('par1', { type: 'parallel' }),
          parNew: createBlock('parNew', { type: 'parallel' }),
          loopSame: createBlock('loopSame', { type: 'loop' }),
        },
        parallels: {
          par1: {
            id: 'par1',
            nodes: ['x'],
            parallelType: 'collection',
            distribution: '<start.list>',
            enabled: true,
          },
          parNew: { id: 'parNew', nodes: [], parallelType: 'count', count: 3, enabled: true },
        },
        /* Same membership in a different order is not a change. */
        loops: { loopSame: { id: 'loopSame', nodes: ['z', 'y'], loopType: 'for', iterations: 1 } },
      })

      const result = generateWorkflowDiffSummary(current, previous)

      expect(result.parallelChanges).toEqual({ added: 1, removed: 1, modified: 1 })
      expect(result.loopChanges).toEqual({ added: 0, removed: 0, modified: 0 })
      expect(result.containerChanges).toEqual([
        {
          id: 'par1',
          kind: 'parallel',
          name: 'Block par1',
          changes: [
            { field: 'parallelType', oldValue: 'count', newValue: 'collection' },
            { field: 'count', oldValue: 2, newValue: null },
            { field: 'distribution', oldValue: null, newValue: '<start.list>' },
          ],
          nodesAdded: [],
          nodesRemoved: [],
        },
      ])
    }
  )
})

function summary(overrides: Partial<WorkflowDiffSummary> = {}): WorkflowDiffSummary {
  return {
    addedBlocks: [],
    removedBlocks: [],
    modifiedBlocks: [],
    edgeChanges: { added: 0, removed: 0, addedDetails: [], removedDetails: [] },
    loopChanges: { added: 0, removed: 0, modified: 0 },
    parallelChanges: { added: 0, removed: 0, modified: 0 },
    containerChanges: [],
    variableChanges: {
      added: 0,
      removed: 0,
      modified: 0,
      addedNames: [],
      removedNames: [],
      modifiedNames: [],
    },
    hasChanges: false,
    ...overrides,
  }
}

describe('omitPresentationChanges', () => {
  it('hides presentation-only rows, drops blocks left empty and recomputes hasChanges', () => {
    const only = summary({
      modifiedBlocks: [
        {
          id: 'a',
          type: 'function',
          name: 'a',
          changes: [
            { scope: 'block', field: 'horizontalHandles', oldValue: true, newValue: false },
            { scope: 'block', field: 'tools.properties', oldValue: {}, newValue: {} },
          ],
        },
        {
          id: 'b',
          type: 'function',
          name: 'b',
          changes: [
            { scope: 'block', field: 'horizontalHandles', oldValue: true, newValue: false },
            { scope: 'subblock', field: 'code', oldValue: 'x', newValue: 'y' },
          ],
        },
      ],
      hasChanges: true,
    })

    const next = omitPresentationChanges(only)

    expect(next.modifiedBlocks).toEqual([
      {
        id: 'b',
        type: 'function',
        name: 'b',
        changes: [{ scope: 'subblock', field: 'code', oldValue: 'x', newValue: 'y' }],
      },
    ])
    expect(next.hasChanges).toBe(true)

    /* The basic/advanced mode decides which stored value executes, so it is never hidden. */
    const modeOnly = summary({
      modifiedBlocks: [
        {
          id: 'c',
          type: 'slack',
          name: 'c',
          changes: [
            {
              scope: 'block',
              field: 'data.canonicalModes',
              oldValue: {},
              newValue: { channel: 'advanced' },
            },
          ],
        },
      ],
      hasChanges: true,
    })
    expect(omitPresentationChanges(modeOnly).modifiedBlocks).toHaveLength(1)

    const presentationOnly = summary({
      modifiedBlocks: [only.modifiedBlocks[0]],
      hasChanges: true,
    })
    expect(omitPresentationChanges(presentationOnly)).toMatchObject({
      modifiedBlocks: [],
      hasChanges: false,
    })
    expect(
      omitPresentationChanges(
        summary({
          modifiedBlocks: [only.modifiedBlocks[0]],
          edgeChanges: { added: 1, removed: 0, addedDetails: [], removedDetails: [] },
          hasChanges: true,
        })
      ).hasChanges
    ).toBe(true)
  })
})

describe('containerConfigFields', () => {
  it('reports only the settings the loop or parallel type uses', () => {
    const state = {
      loops: {
        l: {
          id: 'l',
          nodes: [],
          loopType: 'forEach' as const,
          iterations: 5,
          forEachItems: '<start.items>',
        },
      },
      parallels: {
        p: { id: 'p', nodes: [], parallelType: 'count' as const, count: 3, distribution: 'x' },
      },
    } as unknown as Pick<WorkflowState, 'loops' | 'parallels'>

    expect(containerConfigFields(state, 'l')).toEqual([
      { field: 'loopType', value: 'forEach' },
      { field: 'forEachItems', value: '<start.items>' },
    ])
    expect(containerConfigFields(state, 'p')).toEqual([
      { field: 'parallelType', value: 'count' },
      { field: 'count', value: 3 },
    ])
    expect(containerConfigFields(state, 'missing')).toEqual([])
  })
})
