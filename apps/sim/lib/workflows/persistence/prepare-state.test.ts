/**
 * @vitest-environment node
 *
 * Tests the single normalization pipeline shared by `PUT /api/workflows/[id]/state`
 * and `POST /api/v1/workflows/import`. Both write paths must land identical data
 * for identical input, so this is where that behavior is pinned.
 */

import { describe, expect, it } from 'vitest'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import type { BlockState } from '@/stores/workflows/workflow/types'

function block(overrides: Partial<BlockState> & { id: string }): BlockState {
  return {
    type: 'function',
    name: `Block ${overrides.id}`,
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  } as BlockState
}

describe('prepareWorkflowStateForPersistence', () => {
  it('drops edges whose endpoints do not resolve', () => {
    const { state, warnings } = prepareWorkflowStateForPersistence({
      blocks: { a: block({ id: 'a' }), b: block({ id: 'b' }) },
      edges: [
        { id: 'good', source: 'a', target: 'b' },
        { id: 'dangling', source: 'a', target: 'ghost' },
      ] as never,
    })

    expect(state.edges.map((e) => e.id)).toEqual(['good'])
    expect(warnings.some((w) => w.includes('dangling'))).toBe(true)
  })

  it('drops blocks missing type or name', () => {
    const { state } = prepareWorkflowStateForPersistence({
      blocks: {
        ok: block({ id: 'ok' }),
        noType: block({ id: 'noType', type: '' }),
        noName: block({ id: 'noName', name: '' }),
      },
      edges: [] as never,
    })

    expect(Object.keys(state.blocks)).toEqual(['ok'])
  })

  it('backfills the columns the normalized tables require', () => {
    const { state } = prepareWorkflowStateForPersistence({
      blocks: {
        a: {
          id: 'a',
          type: 'function',
          name: 'A',
          position: { x: 1, y: 2 },
        } as unknown as BlockState,
      },
      edges: [] as never,
    })

    expect(state.blocks.a).toMatchObject({
      enabled: true,
      horizontalHandles: true,
      height: 0,
      subBlocks: {},
      outputs: {},
    })
  })

  it('recomputes loop and parallel containers from the blocks', () => {
    const { state } = prepareWorkflowStateForPersistence({
      blocks: {
        loop1: block({ id: 'loop1', type: 'loop', data: { count: 3, loopType: 'for' } as never }),
        child: block({ id: 'child', data: { parentId: 'loop1', extent: 'parent' } as never }),
        par1: block({
          id: 'par1',
          type: 'parallel',
          data: { count: 2, parallelType: 'count' } as never,
        }),
        childP: block({ id: 'childP', data: { parentId: 'par1', extent: 'parent' } as never }),
      },
      edges: [] as never,
    })

    expect(state.loops.loop1?.nodes).toEqual(['child'])
    expect(state.parallels.par1?.nodes).toEqual(['childP'])
  })

  it('does not mutate the caller-supplied blocks', () => {
    const blocks = { a: block({ id: 'a' }) }
    const snapshot = structuredClone(blocks)

    prepareWorkflowStateForPersistence({ blocks, edges: [] as never })

    expect(blocks).toEqual(snapshot)
  })
})
