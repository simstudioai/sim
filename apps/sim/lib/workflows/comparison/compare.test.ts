/**
 * Tests for workflow change detection comparison logic
 */
import {
  createBlock as createTestBlock,
  createWorkflowState as createTestWorkflowState,
} from '@sim/testing'
import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  formatDiffSummaryForDescription,
  generateWorkflowDiffSummary,
  hasWorkflowChanged,
} from './compare'

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
  describe('Basic Cases', () => {
    it.concurrent('should return true when deployedState is null', () => {
      const currentState = createWorkflowState()
      expect(hasWorkflowChanged(currentState, null)).toBe(true)
    })

    it.concurrent('should return false for identical empty states', () => {
      const state1 = createWorkflowState()
      const state2 = createWorkflowState()
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
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

    it.concurrent('should ignore layout changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { layout: { measuredWidth: 100, measuredHeight: 200 } }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { layout: { measuredWidth: 300, measuredHeight: 400 } }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore height changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { height: 100 }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { height: 500 }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should ignore width/height in data object', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { data: { width: 100, height: 200, name: 'test' } }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', { data: { width: 300, height: 400, name: 'test' } }),
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

    it.concurrent('should detect removed edges', () => {
      const state1 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
      })
      const state2 = createWorkflowState({ edges: [] })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect changed edge connections', () => {
      const state1 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
      })
      const state2 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', target: 'block3' }],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect changed edge handles', () => {
      const state1 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'out1', target: 'block2' }],
      })
      const state2 = createWorkflowState({
        edges: [{ id: 'edge1', source: 'block1', sourceHandle: 'out2', target: 'block2' }],
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
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

    it.concurrent('should detect removed blocks', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const state2 = createWorkflowState({ blocks: {} })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect block type changes', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { type: 'agent' }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { type: 'function' }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect block name changes', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { name: 'Original Name' }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { name: 'Changed Name' }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect enabled/disabled changes', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { enabled: true }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { enabled: false }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect locked/unlocked changes', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: false }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: true }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should not detect changes when locked state is the same', () => {
      const state1 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: true }) },
      })
      const state2 = createWorkflowState({
        blocks: { block1: createBlock('block1', { locked: true }) },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(false)
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

    it.concurrent('should detect subBlock value changes (number)', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.7 } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.9 } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect subBlock value changes (boolean)', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: true } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: false } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect subBlock value changes (object)', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { config: { value: { model: 'gpt-4', temp: 0.7 } } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { config: { value: { model: 'gpt-4o', temp: 0.7 } } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect added subBlocks', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              prompt: { value: 'Hello' },
              model: { value: 'gpt-4' },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect removed subBlocks', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              prompt: { value: 'Hello' },
              model: { value: 'gpt-4' },
            },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello' } },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect subBlock type changes', () => {
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
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
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

    it.concurrent('should detect tool count changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [{ id: 'tool1', name: 'Search' }],
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
                  { id: 'tool1', name: 'Search' },
                  { id: 'tool2', name: 'Calculator' },
                ],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
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

    it.concurrent('should detect value changes in inputFormat', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [{ id: 'input1', name: 'Name', value: 'John' }],
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
                value: [{ id: 'input1', name: 'Name', value: 'Jane' }],
              },
            },
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect actual inputFormat changes', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [{ id: 'input1', name: 'Name', type: 'string' }],
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
                value: [{ id: 'input1', name: 'Name', type: 'number' }], // Changed type
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

    it.concurrent('should detect removed loops', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
        },
      })
      const state2 = createWorkflowState({ loops: {} })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect loop iteration changes', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 10 },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect loop type changes', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            loopType: 'forEach',
            forEachItems: '[]',
            iterations: 0,
          },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect loop nodes changes', () => {
      const state1 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
        },
      })
      const state2 = createWorkflowState({
        loops: {
          loop1: { id: 'loop1', nodes: ['block1', 'block2'], loopType: 'for', iterations: 5 },
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

    it.concurrent('should detect removed parallels', () => {
      const state1 = createWorkflowState({
        parallels: {
          parallel1: { id: 'parallel1', nodes: ['block1'], parallelType: 'count', count: 3 },
        },
      })
      const state2 = createWorkflowState({ parallels: {} })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect parallel count changes', () => {
      const state1 = createWorkflowState({
        parallels: {
          parallel1: { id: 'parallel1', nodes: ['block1'], parallelType: 'count', count: 3 },
        },
      })
      const state2 = createWorkflowState({
        parallels: {
          parallel1: { id: 'parallel1', nodes: ['block1'], parallelType: 'count', count: 5 },
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect parallel type changes', () => {
      const state1 = createWorkflowState({
        parallels: {
          parallel1: { id: 'parallel1', nodes: ['block1'], parallelType: 'count', count: 3 },
        },
      })
      const state2 = createWorkflowState({
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            parallelType: 'collection',
            distribution: '<items>',
          },
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
    it.concurrent(
      'should handle complex workflow with multiple blocks, edges, loops, and parallels',
      () => {
        const state1 = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              position: { x: 0, y: 0 },
              subBlocks: { prompt: { value: 'Hello' } },
            }),
            block2: createBlock('block2', {
              position: { x: 200, y: 0 },
              subBlocks: { model: { value: 'gpt-4' } },
            }),
            block3: createBlock('block3', {
              position: { x: 400, y: 0 },
              subBlocks: { temperature: { value: 0.7 } },
            }),
          },
          edges: [
            { id: 'edge1', source: 'block1', target: 'block2' },
            { id: 'edge2', source: 'block2', target: 'block3' },
          ],
          loops: {
            loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
          },
          parallels: {
            parallel1: {
              id: 'parallel1',
              nodes: ['block2', 'block3'],
              parallelType: 'count',
              count: 3,
            },
          },
        })

        // Same workflow with different positions
        const state2 = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              position: { x: 100, y: 100 },
              subBlocks: { prompt: { value: 'Hello' } },
            }),
            block2: createBlock('block2', {
              position: { x: 300, y: 100 },
              subBlocks: { model: { value: 'gpt-4' } },
            }),
            block3: createBlock('block3', {
              position: { x: 500, y: 100 },
              subBlocks: { temperature: { value: 0.7 } },
            }),
          },
          edges: [
            { id: 'edge2', source: 'block2', target: 'block3' },
            { id: 'edge1', source: 'block1', target: 'block2' },
          ],
          loops: {
            loop1: { id: 'loop1', nodes: ['block1'], loopType: 'for', iterations: 5 },
          },
          parallels: {
            parallel1: {
              id: 'parallel1',
              nodes: ['block2', 'block3'],
              parallelType: 'count',
              count: 3,
            },
          },
        })

        expect(hasWorkflowChanged(state1, state2)).toBe(false)
      }
    )

    it.concurrent('should detect even small text changes in prompts', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'You are a helpful assistant.' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'You are a helpful assistant' } }, // Missing period
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should detect whitespace changes in text', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello World' } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello  World' } }, // Extra space
          }),
        },
      })
      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

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

    it.concurrent('should handle undefined edges in state', () => {
      const state1 = { blocks: {}, loops: {}, parallels: {} } as unknown as WorkflowState
      const state2 = createWorkflowState()

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle undefined loops in state', () => {
      const state1 = { blocks: {}, edges: [], parallels: {} } as unknown as WorkflowState
      const state2 = createWorkflowState()

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle undefined parallels in state', () => {
      const state1 = { blocks: {}, edges: [], loops: {} } as unknown as WorkflowState
      const state2 = createWorkflowState()

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle blocks with no subBlocks', () => {
      const state1 = createWorkflowState({
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test',
            type: 'agent',
            position: { x: 0, y: 0 },
          } as any,
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test',
            type: 'agent',
            position: { x: 100, y: 100 },
            subBlocks: {},
          } as any,
        },
      })

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle very long string values', () => {
      const longString1 = 'a'.repeat(10000)
      const longString2 = `${'a'.repeat(9999)}b`

      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: longString1 } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: longString2 } },
          }),
        },
      })

      expect(hasWorkflowChanged(state1, state2)).toBe(true)
    })

    it.concurrent('should handle deeply nested subBlock values', () => {
      const deepNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: { value: 'deep' },
              },
            },
          },
        },
      }

      const state1 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { config: { value: deepNested } },
          }),
        },
      })
      const state2 = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { config: { value: { ...deepNested } } },
          }),
        },
      })

      expect(hasWorkflowChanged(state1, state2)).toBe(false)
    })

    it.concurrent('should handle array subBlock values', () => {
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
            subBlocks: { items: { value: [1, 2, 3] } },
          }),
        },
      })

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

    it.concurrent('should detect change when tool param has actual content', () => {
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
                    params: { query: 'hello' }, // Has content
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should not detect change when tool isExpanded toggles', () => {
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
                    isExpanded: false,
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
                    isExpanded: true, // Changed expansion state
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

    it.concurrent('should detect change when tool is added then params filled', () => {
      // Deployed state has no tools
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: { value: [] },
            },
          }),
        },
      })

      // Current state has a tool with empty params (just added)
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

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent(
      'should not detect change when adding and removing tool returns to original',
      () => {
        // Original deployed state has no tools
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: {
                tools: { value: [] },
              },
            }),
          },
        })

        // User added a tool, then removed it - back to empty array
        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: {
                tools: { value: [] },
              },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )

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

    it.concurrent('should detect tool order changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  { type: 'search', title: 'Search', toolId: 'search', usageControl: 'auto' },
                  { type: 'calculator', title: 'Calculator', toolId: 'calc', usageControl: 'auto' },
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
                  { type: 'calculator', title: 'Calculator', toolId: 'calc', usageControl: 'auto' },
                  { type: 'search', title: 'Search', toolId: 'search', usageControl: 'auto' },
                ],
              },
            },
          }),
        },
      })

      // Tool order matters - affects execution order
      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect operation changes in multi-operation tools', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'slack',
                    title: 'Slack',
                    toolId: 'slack_send_message',
                    operation: 'send_message',
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
                    type: 'slack',
                    title: 'Slack',
                    toolId: 'slack_list_channels',
                    operation: 'list_channels', // Different operation
                    params: {},
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

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

    it.concurrent('should detect custom tool ID changes', () => {
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

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'custom-tool',
                    customToolId: 'tool-456', // Different tool
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should handle MCP tool with schema changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              tools: {
                value: [
                  {
                    type: 'mcp',
                    title: 'MCP Tool',
                    toolId: 'mcp-server-tool',
                    params: { serverId: 'server-1', toolName: 'tool-1' },
                    schema: { properties: { input: { type: 'string' } } },
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
                    type: 'mcp',
                    title: 'MCP Tool',
                    toolId: 'mcp-server-tool',
                    params: { serverId: 'server-1', toolName: 'tool-1' },
                    schema: { properties: { input: { type: 'number' } } }, // Changed schema
                    usageControl: 'auto',
                  },
                ],
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })
  })

  describe('Input Format Field Scenarios', () => {
    it.concurrent('should not detect change when only inputFormat collapsed changes', () => {
      // The "collapsed" field in inputFormat is UI-only and should be ignored
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [
                  { id: 'field1', name: 'Name', type: 'string', value: 'test', collapsed: false },
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
              inputFormat: {
                value: [
                  {
                    id: 'field1',
                    name: 'Name',
                    type: 'string',
                    value: 'test',
                    collapsed: true,
                  },
                ],
              },
            },
          }),
        },
      })

      // collapsed is UI-only field - should NOT detect as change
      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should detect change when inputFormat value changes', () => {
      // The "value" field in inputFormat is meaningful and should trigger change detection
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [{ id: 'field1', name: 'Name', type: 'string', value: '' }],
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
                value: [{ id: 'field1', name: 'Name', type: 'string', value: 'new value' }],
              },
            },
          }),
        },
      })

      // value changes should be detected
      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect change when inputFormat field name changes', () => {
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
                value: [{ id: 'field1', name: 'Full Name', type: 'string' }], // Changed name
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect change when inputFormat field type changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: {
              inputFormat: {
                value: [{ id: 'field1', name: 'Count', type: 'string' }],
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
                value: [{ id: 'field1', name: 'Count', type: 'number' }], // Changed type
              },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

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

    it.concurrent('should detect change when there is remaining text', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Original prompt' } },
          }),
        },
      })

      // User edited the prompt
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Original promp' } }, // Missing last character
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
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

    it.concurrent('should detect change for trailing whitespace', () => {
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
            subBlocks: { prompt: { value: 'Hello ' } }, // Trailing space
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect change for newline differences', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Line 1\nLine 2' } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Line 1\n\nLine 2' } }, // Extra newline
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should handle case sensitivity in text', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'Hello World' } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { prompt: { value: 'hello world' } }, // Different case
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })
  })

  describe('Model and Dropdown Scenarios', () => {
    it.concurrent('should detect model changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { model: { value: 'gpt-4' } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { model: { value: 'gpt-4o' } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent(
      'should not detect change when selecting then deselecting back to original',
      () => {
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: { model: { value: 'gpt-4' } },
            }),
          },
        })

        // User changed to gpt-4o, then changed back to gpt-4
        const currentState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              subBlocks: { model: { value: 'gpt-4' } },
            }),
          },
        })

        expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
      }
    )

    it.concurrent('should detect slider value changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.7 } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.8 } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should not detect slider change when moved back to original value', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.7 } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { temperature: { value: 0.7 } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should detect boolean toggle changes', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: true } },
          }),
        },
      })

      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: false } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should not detect change when toggle is toggled back', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: true } },
          }),
        },
      })

      // User toggled off, then toggled back on
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            subBlocks: { stream: { value: true } },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
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

    it.concurrent('should detect removed variables', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {},
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should detect variable value changes', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'world' },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should detect variable type changes', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'string', value: '123' },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'myVar', type: 'number', value: 123 },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should detect variable name changes', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'oldName', type: 'string', value: 'hello' },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'newName', type: 'string', value: 'hello' },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should not detect change for identical variables', () => {
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
          var1: { id: 'var1', name: 'myVar', type: 'string', value: 'hello' },
          var2: { id: 'var2', name: 'count', type: 'number', value: 42 },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(false)
    })

    it.concurrent('should not detect change for empty variables on both sides', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {},
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {},
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(false)
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

    it.concurrent('should handle complex variable values (objects)', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'config', type: 'object', value: { key: 'value1' } },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'config', type: 'object', value: { key: 'value2' } },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
    })

    it.concurrent('should handle complex variable values (arrays)', () => {
      const deployedState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'items', type: 'array', value: [1, 2, 3] },
        },
      }

      const currentState = {
        ...createWorkflowState({}),
        variables: {
          var1: { id: 'var1', name: 'items', type: 'array', value: [1, 2, 4] },
        },
      }

      expect(hasWorkflowChanged(currentState as any, deployedState as any)).toBe(true)
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

  describe('Trigger Runtime Metadata (Should Not Trigger Change)', () => {
    it.concurrent('should not detect change when webhookId differs', () => {
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
              model: { value: 'gpt-4' },
              webhookId: { value: 'wh_123456' },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should not detect change when triggerPath differs', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1', {
            type: 'starter',
            subBlocks: {
              model: { value: 'gpt-4' },
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
              triggerPath: { value: '/api/webhooks/abc123' },
            },
          }),
        },
      })

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

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

    it.concurrent(
      'should not detect change when runtime metadata is added to current state',
      () => {
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4' },
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
      }
    )

    it.concurrent(
      'should not detect change when runtime metadata is removed from current state',
      () => {
        const deployedState = createWorkflowState({
          blocks: {
            block1: createBlock('block1', {
              type: 'starter',
              subBlocks: {
                model: { value: 'gpt-4' },
                webhookId: { value: 'wh_old123' },
                triggerPath: { value: '/api/webhooks/old' },
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

    it.concurrent('should not detect change when validationError has value vs missing', () => {
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
          type: 'number',
          value: 'invalid',
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
          type: 'number',
          value: 'invalid',
          validationError: 'Not a valid number',
        },
      }

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(false)
    })

    it.concurrent('should detect change when variable value differs', () => {
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
          value: 'old value',
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
          value: 'new value',
          validationError: undefined,
        },
      }

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect change when variable is added', () => {
      const deployedState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
        },
      })
      ;(deployedState as any).variables = {}

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
        },
      }

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
    })

    it.concurrent('should detect change when variable is removed', () => {
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
      ;(currentState as any).variables = {}

      expect(hasWorkflowChanged(currentState, deployedState)).toBe(true)
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

    it.concurrent('should return hasChanges=false for identical states', () => {
      const state = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const result = generateWorkflowDiffSummary(state, state)
      expect(result.hasChanges).toBe(false)
      expect(result.addedBlocks).toHaveLength(0)
      expect(result.removedBlocks).toHaveLength(0)
      expect(result.modifiedBlocks).toHaveLength(0)
    })
  })

  describe('Block Changes', () => {
    it.concurrent('should detect added blocks', () => {
      const previousState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.addedBlocks).toHaveLength(1)
      expect(result.addedBlocks[0].id).toBe('block2')
    })

    it.concurrent('should detect removed blocks', () => {
      const previousState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
      })
      const currentState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.removedBlocks).toHaveLength(1)
      expect(result.removedBlocks[0].id).toBe('block2')
    })

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

  describe('Edge Changes', () => {
    it.concurrent('should detect added edges', () => {
      const previousState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
        edges: [],
      })
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
        edges: [{ id: 'e1', source: 'block1', target: 'block2' }],
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.edgeChanges.added).toBe(1)
      expect(result.edgeChanges.removed).toBe(0)
    })

    it.concurrent('should detect removed edges', () => {
      const previousState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
        edges: [{ id: 'e1', source: 'block1', target: 'block2' }],
      })
      const currentState = createWorkflowState({
        blocks: {
          block1: createBlock('block1'),
          block2: createBlock('block2'),
        },
        edges: [],
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.edgeChanges.added).toBe(0)
      expect(result.edgeChanges.removed).toBe(1)
    })
  })

  describe('Variable Changes', () => {
    it.concurrent('should detect added variables', () => {
      const previousState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
        variables: {},
      })
      const currentState = createWorkflowState({
        blocks: { block1: createBlock('block1') },
        variables: { var1: { id: 'var1', name: 'test', type: 'string', value: 'hello' } },
      })
      const result = generateWorkflowDiffSummary(currentState, previousState)
      expect(result.hasChanges).toBe(true)
      expect(result.variableChanges.added).toBe(1)
    })

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

    it.concurrent('should return same result as hasWorkflowChanged for no changes', () => {
      const state = createWorkflowState({
        blocks: { block1: createBlock('block1') },
      })

      const diffResult = generateWorkflowDiffSummary(state, state)
      const hasChangedResult = hasWorkflowChanged(state, state)

      expect(diffResult.hasChanges).toBe(hasChangedResult)
      expect(diffResult.hasChanges).toBe(false)
    })
  })
})

describe('formatDiffSummaryForDescription', () => {
  it.concurrent('should return no changes message when hasChanges is false', () => {
    const summary = {
      addedBlocks: [],
      removedBlocks: [],
      modifiedBlocks: [],
      edgeChanges: { added: 0, removed: 0 },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: { added: 0, removed: 0, modified: 0 },
      hasChanges: false,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('No structural changes')
  })

  it.concurrent('should format added blocks', () => {
    const summary = {
      addedBlocks: [{ id: 'block1', type: 'agent', name: 'My Agent' }],
      removedBlocks: [],
      modifiedBlocks: [],
      edgeChanges: { added: 0, removed: 0 },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: { added: 0, removed: 0, modified: 0 },
      hasChanges: true,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Added block: My Agent (agent)')
  })

  it.concurrent('should format removed blocks', () => {
    const summary = {
      addedBlocks: [],
      removedBlocks: [{ id: 'block1', type: 'function', name: 'Old Function' }],
      modifiedBlocks: [],
      edgeChanges: { added: 0, removed: 0 },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: { added: 0, removed: 0, modified: 0 },
      hasChanges: true,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Removed block: Old Function (function)')
  })

  it.concurrent('should format modified blocks with field changes', () => {
    const summary = {
      addedBlocks: [],
      removedBlocks: [],
      modifiedBlocks: [
        {
          id: 'block1',
          type: 'agent',
          name: 'Agent 1',
          changes: [{ field: 'model', oldValue: 'gpt-4o', newValue: 'claude-sonnet' }],
        },
      ],
      edgeChanges: { added: 0, removed: 0 },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: { added: 0, removed: 0, modified: 0 },
      hasChanges: true,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Modified Agent 1')
    expect(result).toContain('model')
    expect(result).toContain('gpt-4o')
    expect(result).toContain('claude-sonnet')
  })

  it.concurrent('should format edge changes', () => {
    const summary = {
      addedBlocks: [],
      removedBlocks: [],
      modifiedBlocks: [],
      edgeChanges: { added: 2, removed: 1 },
      loopChanges: { added: 0, removed: 0, modified: 0 },
      parallelChanges: { added: 0, removed: 0, modified: 0 },
      variableChanges: { added: 0, removed: 0, modified: 0 },
      hasChanges: true,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Added 2 connection(s)')
    expect(result).toContain('Removed 1 connection(s)')
  })

  it.concurrent('should format variable changes', () => {
    const summary = {
      addedBlocks: [],
      removedBlocks: [],
      modifiedBlocks: [],
      edgeChanges: { added: 0, removed: 0 },
      loopChanges: { added: 0, removed: 0 },
      parallelChanges: { added: 0, removed: 0 },
      variableChanges: { added: 1, removed: 0, modified: 2 },
      hasChanges: true,
    }
    const result = formatDiffSummaryForDescription(summary)
    expect(result).toContain('Variables:')
    expect(result).toContain('1 added')
    expect(result).toContain('2 modified')
  })
})
