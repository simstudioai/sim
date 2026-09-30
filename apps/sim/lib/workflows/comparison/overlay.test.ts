/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { generateWorkflowDiffSummary, type WorkflowDiffSummary } from './compare'
import { buildWorkflowDiffOverlay } from './overlay'

/** Overlay only reads position, data and ids; the cast keeps the fixtures short. */
function asState(state: Record<string, unknown>): WorkflowState {
  return state as unknown as WorkflowState
}

interface BlockOptions {
  type?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  height?: number
  subBlocks?: Record<string, { value: unknown }>
}

function block(id: string, options: BlockOptions = {}) {
  return {
    id,
    type: options.type ?? 'function',
    name: id,
    position: options.position ?? { x: 0, y: 0 },
    subBlocks: options.subBlocks ?? {},
    outputs: {},
    enabled: true,
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.data ? { data: options.data } : {}),
  }
}

function emptySummary(): WorkflowDiffSummary {
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
  }
}

describe('buildWorkflowDiffOverlay', () => {
  it('maps the summary onto block status and changed fields, including moves and containers', () => {
    const base = asState({
      blocks: {
        keep: block('keep'),
        gone: block('gone', { position: { x: 900, y: 900 } }),
        mod: block('mod'),
        mover: block('mover', { data: { parentId: 'loop1' } }),
        loop1: block('loop1', { type: 'loop' }),
      },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: ['mover'], loopType: 'for', iterations: 1 } },
    })
    const target = asState({
      blocks: {
        keep: block('keep'),
        fresh: block('fresh'),
        mod: block('mod'),
        mover: block('mover'),
        loop1: block('loop1', { type: 'loop' }),
      },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: [], loopType: 'for', iterations: 1 } },
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      addedBlocks: [{ id: 'fresh', type: 'function', name: 'fresh' }],
      removedBlocks: [{ id: 'gone', type: 'function', name: 'gone' }],
      modifiedBlocks: [
        {
          id: 'mod',
          type: 'function',
          name: 'mod',
          changes: [
            { field: 'code', oldValue: 'a', newValue: 'b' },
            { field: 'name', oldValue: 'x', newValue: 'y' },
          ],
        },
      ],
      containerChanges: [
        {
          id: 'loop1',
          kind: 'loop',
          name: 'loop1',
          changes: [],
          nodesAdded: [],
          nodesRemoved: ['mover'],
        },
      ],
      hasChanges: true,
    }

    const overlay = buildWorkflowDiffOverlay(summary, base, target)

    expect(overlay.blockStatus).toEqual({
      fresh: 'added',
      gone: 'removed',
      mod: 'modified',
      loop1: 'modified',
      mover: 'modified',
    })
    expect(overlay.changedFieldsByBlock).toEqual({ mod: ['code', 'name'] })
    /* The ghost is drawn at its old spot; nothing lived there so it is not nudged. */
    expect(overlay.mergedState.blocks.gone).toBe(base.blocks.gone)
    expect(Object.keys(overlay.mergedState.blocks).sort()).toEqual([
      'fresh',
      'gone',
      'keep',
      'loop1',
      'mod',
      'mover',
    ])
  })

  it('never downgrades an added or removed container to modified', () => {
    const base = asState({ blocks: {}, edges: [], loops: {} })
    const target = asState({
      blocks: { loop1: block('loop1', { type: 'loop' }) },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: [], loopType: 'for', iterations: 1 } },
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      addedBlocks: [{ id: 'loop1', type: 'loop', name: 'loop1' }],
      containerChanges: [
        { id: 'loop1', kind: 'loop', changes: [], nodesAdded: ['x'], nodesRemoved: [] },
      ],
      hasChanges: true,
    }

    expect(buildWorkflowDiffOverlay(summary, base, target).blockStatus).toEqual({
      loop1: 'added',
    })
  })

  it('slides a ghost below the live card that took its place, but leaves container children put', () => {
    const base = asState({
      blocks: {
        gone: block('gone', { position: { x: 10, y: 10 }, height: 100 }),
        loop1: block('loop1', { type: 'loop' }),
        goneChild: block('goneChild', {
          position: { x: 0, y: 0 },
          data: { parentId: 'loop1' },
        }),
      },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: ['goneChild'], loopType: 'for', iterations: 1 } },
    })
    const target = asState({
      blocks: {
        squatter: block('squatter', { position: { x: 0, y: 0 }, data: { height: 120 } }),
        /* Stacked directly below the squatter so the first nudge lands on it too. */
        second: block('second', { position: { x: 0, y: 152 }, height: 80 }),
        /* A child at the same spot must not count as a collision for a top-level ghost. */
        loop1: block('loop1', { type: 'loop', position: { x: 2000, y: 2000 } }),
        liveChild: block('liveChild', {
          position: { x: 10, y: 10 },
          data: { parentId: 'loop1' },
        }),
      },
      edges: [],
      loops: { loop1: { id: 'loop1', nodes: ['liveChild'], loopType: 'for', iterations: 1 } },
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [
        { id: 'gone', type: 'function', name: 'gone' },
        { id: 'goneChild', type: 'function', name: 'goneChild' },
      ],
      addedBlocks: [
        { id: 'squatter', type: 'function', name: 'squatter' },
        { id: 'second', type: 'function', name: 'second' },
        { id: 'liveChild', type: 'function', name: 'liveChild' },
      ],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target).mergedState

    /* 0 + 120 + 32 = 152 hits `second`, so a second nudge lands at 152 + 80 + 32. */
    expect(merged.blocks.gone.position).toEqual({ x: 10, y: 264 })
    expect(merged.blocks.gone).not.toBe(base.blocks.gone)
    expect(merged.blocks.goneChild).toBe(base.blocks.goneChild)
    expect(merged.blocks.goneChild.position).toEqual({ x: 0, y: 0 })
  })

  it('sizes a removed container with no stored size the way the preview draws it', () => {
    const base = asState({
      blocks: { oldLoop: block('oldLoop', { type: 'loop', position: { x: 0, y: 0 } }) },
      edges: [],
      loops: { oldLoop: { id: 'oldLoop', nodes: [], loopType: 'for', iterations: 2 } },
    })
    const target = asState({
      /* Past a plain card's 250px but inside the 500px default container width. */
      blocks: { live: block('live', { position: { x: 400, y: 50 }, height: 100 }) },
      edges: [],
      loops: {},
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [{ id: 'oldLoop', type: 'loop', name: 'oldLoop' }],
      addedBlocks: [{ id: 'live', type: 'function', name: 'live' }],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target).mergedState

    expect(merged.blocks.oldLoop.position).toEqual({ x: 0, y: 182 })
  })

  it('ghosts removed loops and parallels only when their block was removed', () => {
    const base = asState({
      blocks: {
        loopGone: block('loopGone', { type: 'loop' }),
        parKept: block('parKept', { type: 'parallel' }),
      },
      edges: [],
      loops: { loopGone: { id: 'loopGone', nodes: [], loopType: 'for', iterations: 2 } },
      parallels: { parKept: { id: 'parKept', nodes: [], parallelType: 'count', count: 2 } },
    })
    const target = asState({
      blocks: { parKept: block('parKept', { type: 'parallel' }) },
      edges: [],
      /* The target dropped the parallel config while keeping the block: not a removed block. */
      parallels: {},
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [{ id: 'loopGone', type: 'loop', name: 'loopGone' }],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target).mergedState

    expect(merged.loops).toEqual(base.loops)
    expect(merged.parallels).toEqual({})
  })

  it('marks added and removed edges, suffixing a removed edge that shares an id with a rewired one', () => {
    const blocks = { a: block('a'), b: block('b'), c: block('c') }
    const base = asState({
      blocks,
      edges: [
        { id: 'same', source: 'a', target: 'b', sourceHandle: 'source', targetHandle: 'target' },
        /* Same port as the target's `e-keep`, spelled with an empty handle. */
        { id: 'e-keep-old', source: 'b', target: 'c', sourceHandle: '', targetHandle: null },
        { id: 'e-gone', source: 'c', target: 'a', sourceHandle: 'error' },
      ],
    })
    const target = asState({
      blocks,
      edges: [
        { id: 'same', source: 'a', target: 'c', sourceHandle: 'source', targetHandle: 'target' },
        { id: 'e-keep', source: 'b', target: 'c', sourceHandle: null, targetHandle: null },
      ],
      variables: { v1: { id: 'v1', name: 'kept' } },
    })

    const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)

    expect(overlay.edgeStatus).toEqual({
      same: 'added',
      same__removed: 'removed',
      'e-gone': 'removed',
    })
    expect(overlay.mergedState.edges.map((edge) => edge.id)).toEqual([
      'same',
      'e-keep',
      'same__removed',
      'e-gone',
    ])
    const ghost = overlay.mergedState.edges.find((edge) => edge.id === 'same__removed')
    expect(ghost).toMatchObject({ source: 'a', target: 'b' })
    /* Everything else on the target side rides along untouched. */
    expect(overlay.mergedState.variables).toEqual(target.variables)
  })

  it('agrees with generateWorkflowDiffSummary on what counts as unchanged', () => {
    const base = asState({
      blocks: { a: block('a'), b: block('b', { subBlocks: { code: { value: 'x' } } }) },
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: null, targetHandle: null }],
      loops: {},
      parallels: {},
    })
    const target = asState({
      blocks: { a: block('a'), b: block('b', { subBlocks: { code: { value: 'y' } } }) },
      /* An empty handle and an absent one name the same port on both sides. */
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: '', targetHandle: undefined }],
      loops: {},
      parallels: {},
    })

    const summary = generateWorkflowDiffSummary(target, base)
    const overlay = buildWorkflowDiffOverlay(summary, base, target)

    expect(summary.edgeChanges).toMatchObject({ added: 0, removed: 0 })
    expect(overlay.edgeStatus).toEqual({})
    expect(overlay.blockStatus).toEqual({ b: 'modified' })
    expect(overlay.changedFieldsByBlock).toEqual({ b: ['code'] })
  })

  it('keeps a deleted branch on the surviving card so its ghost edge has a handle to leave from', () => {
    const conditions = (items: Array<{ id: string; value: string }>) => ({
      conditions: { value: JSON.stringify(items) },
    })
    const base = asState({
      blocks: {
        cond: block('cond', {
          type: 'condition',
          subBlocks: conditions([
            { id: 'c-if', value: 'a' },
            { id: 'c-elif', value: 'b' },
            { id: 'c-else', value: '' },
          ]),
        }),
        b: block('b'),
      },
      edges: [{ id: 'e', source: 'cond', target: 'b', sourceHandle: 'condition-c-elif' }],
    })
    const target = asState({
      blocks: {
        cond: block('cond', {
          type: 'condition',
          subBlocks: conditions([
            { id: 'c-if', value: 'a' },
            { id: 'c-else', value: '' },
          ]),
        }),
        b: block('b'),
      },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)

    expect(overlay.edgeStatus).toEqual({ e: 'removed' })
    expect(
      JSON.parse(overlay.mergedState.blocks.cond.subBlocks.conditions.value as string).map(
        (item: { id: string }) => item.id
      )
    ).toEqual(['c-if', 'c-elif', 'c-else'])
    /* An untouched block is passed through by identity. */
    expect(overlay.mergedState.blocks.b).toBe(target.blocks.b)
  })

  it('stacks a second ghost below the first and stops sliding after the nudge cap', () => {
    const base = asState({
      blocks: {
        goneA: block('goneA', { position: { x: 0, y: 0 }, height: 100 }),
        goneB: block('goneB', { position: { x: 0, y: 0 }, height: 60 }),
      },
      edges: [],
    })
    const target = asState({
      blocks: { squatter: block('squatter', { position: { x: 0, y: 0 }, height: 120 }) },
      edges: [],
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [
        { id: 'goneA', type: 'function', name: 'goneA' },
        { id: 'goneB', type: 'function', name: 'goneB' },
      ],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target).mergedState
    expect(merged.blocks.goneA.position).toEqual({ x: 0, y: 152 })
    /* Clears the squatter, then the first ghost: 152 + 100 + 32. */
    expect(merged.blocks.goneB.position).toEqual({ x: 0, y: 284 })

    const stack = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `live${index}`,
        block(`live${index}`, { position: { x: 0, y: index * 132 }, height: 100 }),
      ])
    )
    const capped = buildWorkflowDiffOverlay(
      { ...emptySummary(), removedBlocks: [{ id: 'goneA', type: 'function', name: 'goneA' }] },
      base,
      asState({ blocks: stack, edges: [] })
    ).mergedState
    /* Eight nudges of one 132px card each, then the slide gives up. */
    expect(capped.blocks.goneA.position).toEqual({ x: 0, y: 8 * 132 })
  })

  it('slots a deleted branch back where it sat so the surviving else keeps its role', () => {
    const conditions = (ids: string[]) => ({
      conditions: { value: JSON.stringify(ids.map((id) => ({ id, value: id }))) },
    })
    const base = asState({
      blocks: {
        cond: block('cond', { type: 'condition', subBlocks: conditions(['if', 'elif', 'else']) }),
      },
      edges: [],
    })
    const target = asState({
      blocks: { cond: block('cond', { type: 'condition', subBlocks: conditions(['if', 'else']) }) },
      edges: [],
    })

    const merged = buildWorkflowDiffOverlay(emptySummary(), base, target).mergedState
    expect(
      JSON.parse(merged.blocks.cond.subBlocks.conditions.value as string).map(
        (item: { id: string }) => item.id
      )
    ).toEqual(['if', 'elif', 'else'])
  })

  it('never reuses an id when suffixing ghost edges', () => {
    const blocks = { a: block('a'), b: block('b'), c: block('c') }
    const base = asState({
      blocks,
      edges: [
        { id: 'e', source: 'a', target: 'b' },
        { id: 'e', source: 'b', target: 'c' },
      ],
    })
    const target = asState({
      blocks,
      edges: [
        { id: 'e', source: 'a', target: 'c' },
        { id: 'e__removed', source: 'c', target: 'a' },
      ],
    })

    const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)
    expect(overlay.mergedState.edges.map((edge) => edge.id)).toEqual([
      'e',
      'e__removed',
      'e__removed2',
      'e__removed3',
    ])
    expect(overlay.edgeStatus).toEqual({
      e: 'added',
      e__removed: 'added',
      e__removed2: 'removed',
      e__removed3: 'removed',
    })
  })
})
