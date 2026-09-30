/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { remapWorkflowStateBlockIds } from '@/ee/workspace-forking/lib/remap/remap-state-block-ids'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Test states only carry the fields the remap reads; the cast keeps the fixtures short. */
function asState(state: Record<string, unknown>): WorkflowState {
  return state as unknown as WorkflowState
}

const resolve = (id: string) => `t-${id}`

describe('remapWorkflowStateBlockIds', () => {
  it('re-keys blocks and their parentId, leaving a block without a parent untouched', () => {
    const state = asState({
      blocks: {
        loop1: { id: 'loop1', type: 'loop', subBlocks: {}, data: { width: 500 } },
        child: {
          id: 'child',
          type: 'function',
          subBlocks: {},
          data: { parentId: 'loop1', extent: 'parent' },
        },
        orphan: { id: 'orphan', type: 'agent', subBlocks: {} },
      },
      edges: [],
    })

    const out = remapWorkflowStateBlockIds(state, resolve)

    expect(Object.keys(out.blocks).sort()).toEqual(['t-child', 't-loop1', 't-orphan'])
    expect(out.blocks['t-child'].id).toBe('t-child')
    expect(out.blocks['t-child'].data).toEqual({ parentId: 't-loop1', extent: 'parent' })
    expect(out.blocks['t-loop1'].data).toEqual({ width: 500 })
    expect(out.blocks['t-orphan'].data).toBeUndefined()
    /* The input is not mutated. */
    expect(Object.keys(state.blocks)).toEqual(['loop1', 'child', 'orphan'])
    expect(state.blocks.child.data?.parentId).toBe('loop1')
  })

  it('remaps edge endpoints and condition/router handles, passing other handles through', () => {
    const state = asState({
      blocks: {
        cond: { id: 'cond', type: 'condition', subBlocks: {} },
        router: { id: 'router', type: 'router_v2', subBlocks: {} },
        next: { id: 'next', type: 'function', subBlocks: {} },
      },
      edges: [
        {
          id: 'e1',
          source: 'cond',
          target: 'next',
          sourceHandle: 'condition-cond-if',
          targetHandle: 'target',
        },
        { id: 'e2', source: 'router', target: 'next', sourceHandle: 'router-router-abc' },
        { id: 'e3', source: 'next', target: 'cond', sourceHandle: 'error', targetHandle: null },
        { id: 'e4', source: 'next', target: 'cond', sourceHandle: null },
        /* An edge to a block outside the state keeps its unknown id. */
        { id: 'e5', source: 'next', target: 'missing', sourceHandle: 'source' },
      ],
    })

    const out = remapWorkflowStateBlockIds(state, resolve)

    expect(out.edges).toEqual([
      {
        id: 'e1',
        source: 't-cond',
        target: 't-next',
        sourceHandle: 'condition-t-cond-if',
        targetHandle: 'target',
      },
      { id: 'e2', source: 't-router', target: 't-next', sourceHandle: 'router-t-router-abc' },
      { id: 'e3', source: 't-next', target: 't-cond', sourceHandle: 'error', targetHandle: null },
      { id: 'e4', source: 't-next', target: 't-cond', sourceHandle: null },
      { id: 'e5', source: 't-next', target: 'missing', sourceHandle: 'source' },
    ])
  })

  it('rewrites the condition ids embedded in a condition block and leaves other sub-blocks alone', () => {
    const conditions = JSON.stringify([
      { id: 'cond-if', value: 'a > 1' },
      { id: 'cond-else', value: '' },
    ])
    const state = asState({
      blocks: {
        cond: {
          id: 'cond',
          type: 'condition',
          subBlocks: {
            conditions: { id: 'conditions', type: 'condition-input', value: conditions },
            note: { id: 'note', type: 'short-input', value: 'cond-if stays' },
          },
        },
        fn: {
          id: 'fn',
          type: 'function',
          subBlocks: { code: { id: 'code', type: 'code', value: 'return "fn-x"' } },
        },
      },
      edges: [],
    })

    const out = remapWorkflowStateBlockIds(state, resolve)

    expect(JSON.parse(out.blocks['t-cond'].subBlocks.conditions.value as string)).toEqual([
      { id: 't-cond-if', value: 'a > 1' },
      { id: 't-cond-else', value: '' },
    ])
    expect(out.blocks['t-cond'].subBlocks.note.value).toBe('cond-if stays')
    expect(out.blocks['t-fn'].subBlocks.code.value).toBe('return "fn-x"')
    /* The original sub-block value is untouched. */
    expect(state.blocks.cond.subBlocks.conditions.value).toBe(conditions)
  })

  it('re-keys loops and parallels along with their membership', () => {
    const state = asState({
      blocks: {
        loop1: { id: 'loop1', type: 'loop', subBlocks: {} },
        par1: { id: 'par1', type: 'parallel', subBlocks: {} },
        a: { id: 'a', type: 'function', subBlocks: {}, data: { parentId: 'loop1' } },
        b: { id: 'b', type: 'function', subBlocks: {}, data: { parentId: 'par1' } },
      },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: ['a'], loopType: 'for', iterations: 3 } },
      parallels: { par1: { id: 'par1', nodes: ['b'], parallelType: 'count', count: 2 } },
    })

    const out = remapWorkflowStateBlockIds(state, resolve)

    expect(out.loops).toEqual({
      't-loop1': { id: 't-loop1', nodes: ['t-a'], loopType: 'for', iterations: 3 },
    })
    expect(out.parallels).toEqual({
      't-par1': { id: 't-par1', nodes: ['t-b'], parallelType: 'count', count: 2 },
    })
  })

  it('tolerates a state with no edges, loops or parallels', () => {
    const state = asState({ blocks: { a: { id: 'a', type: 'agent', subBlocks: {} } } })

    const out = remapWorkflowStateBlockIds(state, resolve)

    expect(out.edges).toEqual([])
    expect(out.loops).toEqual({})
    expect(out.parallels).toEqual({})
    expect(out.blocks['t-a'].id).toBe('t-a')
  })
})
