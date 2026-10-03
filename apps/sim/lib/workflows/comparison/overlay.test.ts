/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  generateWorkflowDiffSummary,
  type WorkflowDiffSummary,
} from '@/lib/workflows/comparison/compare'
import { buildWorkflowDiffOverlay } from '@/lib/workflows/comparison/overlay'
import { getConditionRows, getRouterRows } from '@/lib/workflows/dynamic-handle-topology'
import { getPreviewBlockDimensions } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow/preview-dimensions'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
  it('keeps removed children clear of surviving siblings in their parent coordinate space', () => {
    const base = asState({
      blocks: {
        loop: block('loop', { type: 'loop' }),
        old: block('old', { data: { parentId: 'loop' }, position: { x: 100, y: 100 } }),
      },
      edges: [],
    })
    const target = asState({
      blocks: {
        loop: block('loop', { type: 'loop' }),
        current: block('current', { data: { parentId: 'loop' }, position: { x: 100, y: 100 } }),
      },
      edges: [],
    })
    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target,
      () => ({ width: 200, height: 100 })
    )
    expect(overlay.mergedState.blocks.old.position.y).toBeGreaterThanOrEqual(200)
    expect(overlay.mergedState.blocks.current.position).toEqual({ x: 100, y: 100 })
    expect(base.blocks.old.position).toEqual({ x: 100, y: 100 })
  })

  it('measures containers after placing their removed children', () => {
    const base = asState({
      blocks: {
        loop: block('loop', { type: 'loop' }),
        old: block('old', { data: { parentId: 'loop' }, position: { x: 0, y: 80 } }),
        rootGhost: block('rootGhost', { position: { x: 0, y: 180 } }),
      },
      edges: [],
    })
    const target = asState({
      blocks: {
        loop: block('loop', { type: 'loop' }),
        current: block('current', { data: { parentId: 'loop' }, position: { x: 0, y: 80 } }),
      },
      edges: [],
    })
    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target,
      (node, nodes) => ({
        width: 200,
        height:
          node.type === 'loop'
            ? Math.max(
                100,
                ...Object.values(nodes)
                  .filter((child) => child.data?.parentId === node.id)
                  .map((child) => child.position.y + 120)
              )
            : 100,
      })
    )
    const placed = overlay.mergedState.blocks
    expect(placed.rootGhost.position.y).toBeGreaterThan(placed.old.position.y + 100)
  })

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
            { scope: 'subblock', field: 'code', oldValue: 'a', newValue: 'b' },
            { scope: 'block', field: 'name', oldValue: 'x', newValue: 'y' },
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
    expect(overlay.changedFieldsByBlock).toEqual({ mod: ['code'] })
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

  it('slides root and child ghosts below siblings in the same coordinate space', () => {
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
        squatter: block('squatter', { position: { x: 0, y: 0 }, height: 120 }),
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

    /* 0 + 120 + 32 = 152 hits `second`, drawn at the 100px minimum, so it lands at 152 + 100 + 32. */
    expect(merged.blocks.gone.position).toEqual({ x: 10, y: 284 })
    expect(merged.blocks.gone).not.toBe(base.blocks.gone)
    expect(merged.blocks.goneChild.position.y).toBeGreaterThanOrEqual(110)
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

  it('treats a stored height of zero as the minimum card height', () => {
    const base = asState({
      blocks: { gone: block('gone', { position: { x: 0, y: 60 }, height: 0 }) },
      edges: [],
    })
    const target = asState({
      blocks: { live: block('live', { position: { x: 0, y: 0 }, height: 0 }) },
      edges: [],
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [{ id: 'gone', type: 'function', name: 'gone' }],
      addedBlocks: [{ id: 'live', type: 'function', name: 'live' }],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target).mergedState

    /* The live card is at least 100px tall, so the ghost at y=60 overlaps it and slides to 132. */
    expect(merged.blocks.gone.position).toEqual({ x: 0, y: 132 })
  })

  it('sizes boxes with the measurement the canvas passes', () => {
    const base = asState({
      blocks: { gone: block('gone', { position: { x: 0, y: 150 } }) },
      edges: [],
    })
    const target = asState({
      blocks: { live: block('live', { position: { x: 0, y: 0 } }) },
      edges: [],
    })
    const summary: WorkflowDiffSummary = {
      ...emptySummary(),
      removedBlocks: [{ id: 'gone', type: 'function', name: 'gone' }],
      addedBlocks: [{ id: 'live', type: 'function', name: 'live' }],
      hasChanges: true,
    }

    const merged = buildWorkflowDiffOverlay(summary, base, target, () => ({
      width: 250,
      height: 200,
    })).mergedState

    expect(merged.blocks.gone.position).toEqual({ x: 0, y: 232 })
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

  it.each([
    {
      type: 'condition',
      field: 'conditions',
      prefix: 'condition',
      baseIds: ['first', 'second', 'last'],
      targetIds: ['second', 'last'],
      removedId: 'first',
      removedTitle: 'if',
      liveTitles: ['if', 'else'],
    },
    {
      type: 'condition',
      field: 'conditions',
      prefix: 'condition',
      baseIds: ['first', 'second', 'last'],
      targetIds: ['first', 'second'],
      removedId: 'last',
      removedTitle: 'else',
      liveTitles: ['if', 'else'],
    },
    {
      type: 'router_v2',
      field: 'routes',
      prefix: 'router',
      baseIds: ['first', 'second'],
      targetIds: ['second'],
      removedId: 'first',
      removedTitle: 'Route 1',
      liveTitles: ['Route 1'],
    },
  ])(
    'preserves target $type roles when the $removedId branch is removed',
    ({ type, field, prefix, baseIds, targetIds, removedId, removedTitle, liveTitles }) => {
      const branches = (ids: string[]) => ({
        [field]: { value: JSON.stringify(ids.map((id) => ({ id, value: id }))) },
      })
      const base = asState({
        blocks: {
          cond: block('cond', {
            type,
            subBlocks: branches(baseIds),
          }),
          b: block('b'),
        },
        edges: [{ id: 'e', source: 'cond', target: 'b', sourceHandle: `${prefix}-${removedId}` }],
      })
      const target = asState({
        blocks: {
          cond: block('cond', {
            type,
            subBlocks: branches(targetIds),
          }),
          b: block('b'),
        },
        edges: [],
      })

      const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)

      expect(overlay.edgeStatus).toEqual({ e: 'removed' })
      expect(overlay.mergedState.blocks.cond.subBlocks).toEqual(target.blocks.cond.subBlocks)
      const liveValue = overlay.mergedState.blocks.cond.subBlocks[field].value
      const rows =
        type === 'condition'
          ? getConditionRows('cond', liveValue)
          : getRouterRows('cond', liveValue).map((row, index) => ({
              ...row,
              title: `Route ${index + 1}`,
            }))
      expect(rows.map(({ title }) => title)).toEqual(liveTitles)
      expect(overlay.removedPortsByBlock.cond).toEqual([
        {
          handleId: `${prefix}-${removedId}`,
          type: 'source',
          title: removedTitle,
          value: removedId,
        },
      ])
      expect(overlay.mergedState.blocks.b).toBe(target.blocks.b)
    }
  )

  it('stacks ghosts below every overlapping sibling, including more than eight', () => {
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
    expect(capped.blocks.goneA.position.y).toBeGreaterThanOrEqual(11 * 132 + 100)
  })

  it('does not add removed branch rows without a removed edge needing their handles', () => {
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

    const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)
    expect(overlay.mergedState.blocks.cond.subBlocks).toEqual(target.blocks.cond.subBlocks)
    expect(overlay.removedPortsByBlock).toEqual({})
  })

  it('uses the existing branch handle when only its connection was removed', () => {
    const blocks = {
      cond: block('cond', {
        type: 'condition',
        subBlocks: {
          conditions: { value: JSON.stringify([{ id: 'first' }, { id: 'last' }]) },
        },
      }),
      b: block('b'),
    }
    const base = asState({
      blocks,
      edges: [{ id: 'e', source: 'cond', target: 'b', sourceHandle: 'condition-first' }],
    })
    const target = asState({ blocks, edges: [] })

    const overlay = buildWorkflowDiffOverlay(emptySummary(), base, target)
    expect(overlay.edgeStatus).toEqual({ e: 'removed' })
    expect(overlay.mergedState.edges[0].sourceHandle).toBe('condition-first')
    expect(overlay.removedPortsByBlock).toEqual({})
  })

  it('does not duplicate branch rows on a removed whole block', () => {
    const base = asState({
      blocks: {
        cond: block('cond', {
          type: 'condition',
          subBlocks: {
            conditions: { value: JSON.stringify([{ id: 'first' }, { id: 'last' }]) },
          },
        }),
        b: block('b'),
      },
      edges: [{ id: 'e', source: 'cond', target: 'b', sourceHandle: 'condition-first' }],
    })
    const target = asState({ blocks: { b: block('b') }, edges: [] })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.blockStatus.cond).toBe('removed')
    expect(overlay.edgeStatus).toEqual({ e: 'removed' })
    expect(overlay.mergedState.blocks.cond.subBlocks).toEqual(base.blocks.cond.subBlocks)
    expect(overlay.removedPortsByBlock).toEqual({})
  })

  it('keeps a removed branch anchor when its block becomes a container', () => {
    const base = asState({
      blocks: {
        source: block('source', {
          type: 'condition',
          subBlocks: {
            conditions: { value: JSON.stringify([{ id: 'first', value: 'true' }, { id: 'last' }]) },
          },
        }),
        sink: block('sink'),
      },
      edges: [{ id: 'e', source: 'source', target: 'sink', sourceHandle: 'condition-first' }],
    })
    const target = asState({
      blocks: { source: block('source', { type: 'loop' }), sink: base.blocks.sink },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.mergedState.blocks.source.type).toBe('loop')
    expect(overlay.removedPortsByBlock.source).toEqual([
      { handleId: 'condition-first', type: 'source', title: 'if', value: 'true' },
    ])
    expect(overlay.edgeStatus).toEqual({ e: 'removed' })
  })

  it.each([
    { before: 'function', after: 'condition', handles: ['source'] },
    { before: 'loop', after: 'parallel', handles: ['loop-start-source', 'loop-end-source'] },
    {
      before: 'parallel',
      after: 'function',
      handles: ['parallel-start-source', 'parallel-end-source'],
    },
  ])('preserves removed output ports when $before becomes $after', ({ before, after, handles }) => {
    const base = asState({
      blocks: { changed: block('changed', { type: before }), sink: block('sink') },
      edges: handles.map((sourceHandle, index) => ({
        id: `e${index}`,
        source: 'changed',
        target: 'sink',
        sourceHandle,
        targetHandle: 'target',
      })),
    })
    const target = asState({
      blocks: { changed: block('changed', { type: after }), sink: base.blocks.sink },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.removedPortsByBlock.changed).toMatchObject(
      handles.map((handleId) => ({ handleId, type: 'source' }))
    )
    expect(overlay.mergedState.blocks.changed).toBe(target.blocks.changed)
    expect(overlay.mergedState.edges.map((edge) => edge.sourceHandle)).toEqual(handles)
  })

  it('preserves a removed incoming port when its block becomes a trigger', () => {
    const base = asState({
      blocks: { source: block('source'), changed: block('changed') },
      edges: [
        {
          id: 'e',
          source: 'source',
          target: 'changed',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    })
    const target = asState({
      blocks: { source: base.blocks.source, changed: block('changed', { type: 'starter' }) },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.removedPortsByBlock.changed).toMatchObject([
      { handleId: 'target', type: 'target' },
    ])
    expect(overlay.mergedState.edges[0].targetHandle).toBe('target')
  })

  it('preserves an old error port when the target block cannot emit errors', () => {
    const base = asState({
      blocks: { changed: { ...block('changed'), errorEnabled: true }, sink: block('sink') },
      edges: [{ id: 'e', source: 'changed', target: 'sink', sourceHandle: 'error' }],
    })
    const target = asState({
      blocks: { changed: block('changed', { type: 'response' }), sink: base.blocks.sink },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.removedPortsByBlock.changed).toMatchObject([
      { handleId: 'error', type: 'source' },
    ])
  })

  it('retains a removed output once when several removed edges leave it', () => {
    const base = asState({
      blocks: { changed: block('changed'), a: block('a'), b: block('b') },
      edges: [
        { id: 'a', source: 'changed', target: 'a', sourceHandle: 'source' },
        { id: 'b', source: 'changed', target: 'b', sourceHandle: 'source' },
      ],
    })
    const target = asState({
      blocks: { ...base.blocks, changed: block('changed', { type: 'condition' }) },
      edges: [],
    })

    const overlay = buildWorkflowDiffOverlay(
      generateWorkflowDiffSummary(target, base),
      base,
      target
    )
    expect(overlay.removedPortsByBlock.changed).toHaveLength(1)
    expect(overlay.removedPortsByBlock.changed[0]).toMatchObject({
      handleId: 'source',
      type: 'source',
    })
    expect(overlay.mergedState.edges).toHaveLength(2)
  })

  it.each([
    {
      before: 'condition',
      after: 'function',
      beforeHandle: 'condition-first',
      afterHandle: 'source',
    },
    {
      before: 'function',
      after: 'condition',
      beforeHandle: 'source',
      afterHandle: 'condition-first',
    },
  ])(
    'pins implicit handles to each original snapshot for $before → $after',
    ({ before, after, beforeHandle, afterHandle }) => {
      const changed = (type: string) =>
        block('changed', {
          type,
          subBlocks: { conditions: { value: JSON.stringify([{ id: 'first' }, { id: 'last' }]) } },
        })
      const base = asState({
        blocks: { changed: changed(before), oldSink: block('oldSink'), newSink: block('newSink') },
        edges: [
          {
            id: 'old',
            source: 'changed',
            target: 'oldSink',
            sourceHandle: null,
            targetHandle: null,
          },
        ],
      })
      const target = asState({
        blocks: { ...base.blocks, changed: changed(after) },
        edges: [
          {
            id: 'new',
            source: 'changed',
            target: 'newSink',
            sourceHandle: null,
            targetHandle: null,
          },
        ],
      })

      const overlay = buildWorkflowDiffOverlay(
        generateWorkflowDiffSummary(target, base),
        base,
        target
      )
      expect(overlay.mergedState.edges.find((edge) => edge.id === 'old')).toMatchObject({
        sourceHandle: beforeHandle,
        targetHandle: 'target',
      })
      expect(overlay.mergedState.edges.find((edge) => edge.id === 'new')).toMatchObject({
        sourceHandle: afterHandle,
        targetHandle: 'target',
      })
      expect(overlay.removedPortsByBlock.changed).toMatchObject([
        { handleId: beforeHandle, type: 'source' },
      ])
      expect(base.edges[0].sourceHandle).toBeNull()
      expect(target.edges[0].sourceHandle).toBeNull()
      expect(overlay.edgeStatus).toEqual({ new: 'added', old: 'removed' })
    }
  )

  it.each([false, true])(
    'keeps a removed block clear of retained branch rows, nested=%s',
    (nested) => {
      const removedIds = Array.from({ length: 8 }, (_, index) => `removed-${index}`)
      const conditionBlock = (ids: string[], x: number, height: number) =>
        block('cond', {
          type: 'condition',
          position: { x, y: 64 },
          height,
          ...(nested ? { data: { parentId: 'loop' } } : {}),
          subBlocks: {
            conditions: { value: JSON.stringify(ids.map((id) => ({ id, value: id }))) },
          },
        })
      const container = nested ? { loop: block('loop', { type: 'loop' }) } : {}
      const base = asState({
        blocks: {
          ...container,
          cond: conditionBlock(['first', ...removedIds, 'last'], 500, 331),
          gone: block('gone', {
            position: { x: 24, y: 164 },
            height: 100,
            ...(nested ? { data: { parentId: 'loop' } } : {}),
          }),
          sink: block('sink', {
            position: { x: 1200, y: 64 },
            ...(nested ? { data: { parentId: 'loop' } } : {}),
          }),
        },
        edges: removedIds.map((id) => ({
          id: `edge-${id}`,
          source: 'cond',
          target: 'sink',
          sourceHandle: `condition-${id}`,
        })),
      })
      const target = asState({
        blocks: {
          ...container,
          cond: conditionBlock(['first', 'last'], 24, 107),
          sink: base.blocks.sink,
        },
        edges: [],
      })

      const overlay = buildWorkflowDiffOverlay(
        generateWorkflowDiffSummary(target, base),
        base,
        target,
        getPreviewBlockDimensions
      )

      // Ten fixed-height rows occupy 328px before any border or removed-row label.
      expect(overlay.mergedState.blocks.gone.position.y).toBeGreaterThanOrEqual(64 + 328)
    }
  )

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
