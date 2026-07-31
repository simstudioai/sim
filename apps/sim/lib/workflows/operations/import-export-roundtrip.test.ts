/**
 * @vitest-environment node
 *
 * End-to-end round trip through the REAL sanitizer and importer — no mocks of
 * either — pinning the property the export/import API pair exists to provide:
 * a workflow exported by `GET /api/v1/workflows/[id]/export` must re-import
 * through `POST /api/v1/workflows/import` with its graph intact.
 *
 * Guards specifically against silent structural loss (child blocks inside loop
 * and parallel containers, dangling references after id regeneration) that
 * mock-heavy route tests cannot catch.
 */

import { describe, expect, it } from 'vitest'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'

function makeSourceState() {
  return {
    blocks: {
      starter: {
        id: 'starter',
        type: 'starter',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: { input: { id: 'input', type: 'short-input', value: 'hello' } },
        outputs: {},
        enabled: true,
      },
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Loop 1',
        position: { x: 200, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: { width: 500, height: 300, count: 3, loopType: 'for' },
      },
      childInLoop: {
        id: 'childInLoop',
        type: 'function',
        name: 'Child',
        position: { x: 50, y: 50 },
        subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
        outputs: {},
        enabled: true,
        data: { parentId: 'loop1', extent: 'parent' },
      },
      par1: {
        id: 'par1',
        type: 'parallel',
        name: 'Parallel 1',
        position: { x: 800, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: { width: 500, height: 300, count: 2, parallelType: 'count' },
      },
      childInPar: {
        id: 'childInPar',
        type: 'function',
        name: 'Child P',
        position: { x: 60, y: 60 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: { parentId: 'par1', extent: 'parent' },
      },
    } as Record<string, any>,
    edges: [
      { id: 'e1', source: 'starter', target: 'loop1', sourceHandle: 'source', targetHandle: null },
      { id: 'e2', source: 'loop1', target: 'par1' },
    ] as any[],
    loops: {
      loop1: { id: 'loop1', nodes: ['childInLoop'], iterations: 3, loopType: 'for' as const },
    } as Record<string, any>,
    parallels: {
      par1: { id: 'par1', nodes: ['childInPar'], count: 2, parallelType: 'count' as const },
    } as Record<string, any>,
    variables: {
      v1: { id: 'v1', name: 'apiHost', type: 'string' as const, value: 'https://example.com' },
    },
    metadata: { name: 'Round Trip', description: 'probe' },
  }
}

describe('workflow export -> import round trip', () => {
  const exported = sanitizeForExport(makeSourceState() as any)
  const { data: reimported, errors } = parseWorkflowJson(JSON.stringify(exported))

  it('re-imports without validation errors', () => {
    expect(errors).toEqual([])
    expect(reimported).not.toBeNull()
  })

  it('preserves every block, including children inside loop and parallel containers', () => {
    expect(Object.keys(exported.state.blocks).sort()).toEqual([
      'childInLoop',
      'childInPar',
      'loop1',
      'par1',
      'starter',
    ])
    expect(Object.keys(reimported!.blocks)).toHaveLength(5)
  })

  it('preserves every edge', () => {
    expect(reimported!.edges).toHaveLength(2)
  })

  it('leaves no dangling parent, edge, loop or parallel reference after id regeneration', () => {
    const ids = new Set(Object.values(reimported!.blocks).map((b: any) => b.id))

    for (const b of Object.values(reimported!.blocks) as any[]) {
      if (b.data?.parentId) expect(ids.has(b.data.parentId)).toBe(true)
    }
    for (const e of reimported!.edges as any[]) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
    for (const loop of Object.values(reimported!.loops ?? {}) as any[]) {
      for (const n of loop.nodes ?? []) expect(ids.has(n)).toBe(true)
    }
    for (const p of Object.values(reimported!.parallels ?? {}) as any[]) {
      for (const n of p.nodes ?? []) expect(ids.has(n)).toBe(true)
    }
  })

  it('regenerates ids so a payload can be imported alongside its source', () => {
    expect(Object.keys(reimported!.blocks)).not.toContain('starter')
  })

  it('preserves workflow variables', () => {
    expect(reimported!.variables).toMatchObject({
      v1: { id: 'v1', name: 'apiHost', type: 'string', value: 'https://example.com' },
    })
  })

  it('does not hang on a block name containing regex metacharacters', () => {
    const hostile = makeSourceState()
    hostile.blocks.starter.name = 'a*a*a*a*a*a*a*a*b'
    hostile.blocks.starter.subBlocks.input.value = `<${'a'.repeat(120)}`

    const started = performance.now()
    const { data } = parseWorkflowJson(JSON.stringify(sanitizeForExport(hostile as any)))
    const elapsed = performance.now() - started

    expect(data).not.toBeNull()
    expect(elapsed).toBeLessThan(2000)
  })
})
