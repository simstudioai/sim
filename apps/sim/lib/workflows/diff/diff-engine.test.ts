/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

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
  getTargetedLayoutImpact: () => ({
    layoutBlockIds: [],
    shiftSourceBlockIds: [],
  }),
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

vi.mock('@/blocks', () => ({
  getBlock: () => null,
  getAllBlocks: () => ({}),
  getAllBlockTypes: () => [],
  getBlockByToolName: () => null,
  getBlocksByCategory: () => [],
  isValidBlockType: () => false,
  registry: {},
}))

vi.mock('@/tools/utils', () => ({
  getTool: () => null,
}))

vi.mock('@/triggers', () => ({
  getTrigger: () => null,
  isTriggerValid: () => false,
}))

vi.mock('@/lib/workflows/blocks/block-outputs', () => ({
  getEffectiveBlockOutputs: () => ({}),
}))

vi.mock('@/lib/workflows/subblocks/visibility', () => ({
  buildDefaultCanonicalModes: () => ({}),
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TRIGGER_TYPES: {},
  classifyStartBlockType: () => null,
  StartBlockPath: {},
  getTriggerOutputs: () => ({}),
}))

vi.mock('@/hooks/use-trigger-config-aggregation', () => ({
  populateTriggerFieldsFromConfig: () => [],
}))

vi.mock('@/executor/constants', () => ({
  isAnnotationOnlyBlock: () => false,
  BLOCK_DIMENSIONS: { MIN_HEIGHT: 100 },
  HANDLE_POSITIONS: {},
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      activeWorkflowId: null,
    }),
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    getState: () => ({
      workflowValues: {},
      getValue: () => null,
    }),
  },
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
        'should NOT detect a diff when only the locked state changes (false -> true)',
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
          expect(result.diff?.diffAnalysis?.edited_blocks ?? []).not.toContain('block-1')
          expect(
            result.diff?.diffAnalysis?.field_diffs?.['block-1']?.changed_fields ?? []
          ).not.toContain('locked')
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
        expect(result.diff?.diffAnalysis?.edited_blocks ?? []).not.toContain('block-1')
      })

      it.concurrent(
        'should NOT detect a diff when locked goes from undefined to true',
        async () => {
          const freshEngine = new WorkflowDiffEngine()
          const baseline = createMockWorkflowState({
            'block-1': createMockBlock({ id: 'block-1' }),
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
          expect(result.diff?.diffAnalysis?.edited_blocks ?? []).not.toContain('block-1')
        }
      )

      it.concurrent(
        'should still detect real edits on a block whose locked state also changed',
        async () => {
          const freshEngine = new WorkflowDiffEngine()
          const baseline = createMockWorkflowState({
            'block-1': createMockBlock({ id: 'block-1', enabled: true, locked: false }),
          })

          const proposed = createMockWorkflowState({
            'block-1': createMockBlock({ id: 'block-1', enabled: false, locked: true }),
          })

          const result = await freshEngine.createDiffFromWorkflowState(
            proposed,
            undefined,
            baseline
          )

          expect(result.success).toBe(true)
          expect(result.diff?.diffAnalysis?.edited_blocks).toContain('block-1')
          const changed = result.diff?.diffAnalysis?.field_diffs?.['block-1']?.changed_fields ?? []
          expect(changed).toContain('enabled')
          expect(changed).not.toContain('locked')
        }
      )
    })

    describe('parent scope changes', () => {
      it.concurrent('should detect when a block moves into a subflow', async () => {
        const freshEngine = new WorkflowDiffEngine()
        const baseline = createMockWorkflowState({
          'block-1': createMockBlock({ id: 'block-1' }),
        })

        const proposed = createMockWorkflowState({
          'block-1': createMockBlock({
            id: 'block-1',
            data: { parentId: 'loop-1', extent: 'parent' },
          }),
        })

        const result = await freshEngine.createDiffFromWorkflowState(proposed, undefined, baseline)

        expect(result.success).toBe(true)
        expect(result.diff?.diffAnalysis?.edited_blocks).toContain('block-1')
        expect(result.diff?.diffAnalysis?.field_diffs?.['block-1']?.changed_fields).toContain(
          'parentId'
        )
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
