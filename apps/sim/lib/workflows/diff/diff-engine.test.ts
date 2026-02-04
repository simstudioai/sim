/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

// Mock all external dependencies before imports
vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: {
    getState: () => ({
      getWorkflowState: () => ({ blocks: {}, edges: [], loops: {}, parallels: {} }),
    }),
  },
}))

vi.mock('@/stores/workflows/utils', () => ({
  mergeSubblockState: (blocks: Record<string, BlockState>) => blocks,
}))

vi.mock('@/lib/workflows/sanitization/key-validation', () => ({
  isValidKey: (key: string) => key !== 'undefined' && key !== 'null' && key !== '',
}))

vi.mock('@/lib/workflows/autolayout', () => ({
  transferBlockHeights: vi.fn(),
  applyTargetedLayout: (blocks: Record<string, BlockState>) => blocks,
  applyAutoLayout: () => ({ success: true, blocks: {} }),
}))

vi.mock('@/lib/workflows/autolayout/constants', () => ({
  DEFAULT_HORIZONTAL_SPACING: 500,
  DEFAULT_VERTICAL_SPACING: 400,
  DEFAULT_LAYOUT_OPTIONS: {},
}))

vi.mock('@/stores/workflows/workflow/utils', () => ({
  generateLoopBlocks: () => ({}),
  generateParallelBlocks: () => ({}),
}))

import { WorkflowDiffEngine } from './diff-engine'

function createMockBlock(overrides: Partial<BlockState> = {}): BlockState {
  return {
    id: 'block-1',
    type: 'agent',
    name: 'Test Block',
    enabled: true,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    ...overrides,
  } as BlockState
}

function createMockWorkflowState(blocks: Record<string, BlockState>): WorkflowState {
  return {
    blocks,
    edges: [],
    loops: {},
    parallels: {},
  }
}

describe('WorkflowDiffEngine', () => {
  let engine: WorkflowDiffEngine

  beforeEach(() => {
    engine = new WorkflowDiffEngine()
    vi.clearAllMocks()
  })

  describe('hasBlockChanged detection', () => {
    describe('locked state changes', () => {
      it.concurrent(
        'should detect when block locked state changes from false to true',
        async () => {
          const freshEngine = new WorkflowDiffEngine()
          const baseline = createMockWorkflowState({
            'block-1': createMockBlock({ id: 'block-1', locked: false }),
          })

          const proposed = createMockWorkflowState({
            'block-1': createMockBlock({ id: 'block-1', locked: true }),
          })

          const result = await freshEngine.createDiffFromWorkflowState(
            proposed,
            undefined,
            baseline
          )

          expect(result.success).toBe(true)
          expect(result.diff?.diffAnalysis?.edited_blocks).toContain('block-1')
        }
      )

      it.concurrent('should not detect change when locked state is the same', async () => {
        const freshEngine = new WorkflowDiffEngine()
        const baseline = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1', locked: true }),
        })

        const proposed = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1', locked: true }),
        })

        const result = await freshEngine.createDiffFromWorkflowState(proposed, undefined, baseline)

        expect(result.success).toBe(true)
        expect(result.diff?.diffAnalysis?.edited_blocks).not.toContain('block-1')
      })

      it.concurrent('should detect change when locked goes from undefined to true', async () => {
        const freshEngine = new WorkflowDiffEngine()
        const baseline = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1' }), // locked undefined
        })

        const proposed = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1', locked: true }),
        })

        const result = await freshEngine.createDiffFromWorkflowState(proposed, undefined, baseline)

        expect(result.success).toBe(true)
        // The hasBlockChanged function uses !!locked for comparison
        // so undefined -> true should be detected as a change
        expect(result.diff?.diffAnalysis?.edited_blocks).toContain('block-1')
      })

      it.concurrent('should not detect change when both locked states are falsy', async () => {
        const freshEngine = new WorkflowDiffEngine()
        const baseline = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1' }), // locked undefined
        })

        const proposed = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1', locked: false }), // locked false
        })

        const result = await freshEngine.createDiffFromWorkflowState(proposed, undefined, baseline)

        expect(result.success).toBe(true)
        // undefined and false should both be falsy, so !! comparison makes them equal
        expect(result.diff?.diffAnalysis?.edited_blocks).not.toContain('block-1')
      })
    })
  })

  describe('diff lifecycle', () => {
    it.concurrent('should start with no diff', () => {
      const freshEngine = new WorkflowDiffEngine()
      expect(freshEngine.hasDiff()).toBe(false)
      expect(freshEngine.getCurrentDiff()).toBeUndefined()
    })

    it.concurrent('should clear diff', () => {
      const freshEngine = new WorkflowDiffEngine()
      freshEngine.clearDiff()
      expect(freshEngine.hasDiff()).toBe(false)
    })
  })
})
