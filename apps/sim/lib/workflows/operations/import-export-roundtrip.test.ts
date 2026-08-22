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

/**
 * A whole-`{{ENV_VAR}}` reference that appears in exactly one place: a table cell. The leak sweep
 * below greps the serialized envelope for it, so it has to be a value no other fixture uses and
 * the same symbol has to feed both the fixture and the assertion — spelling the string twice is
 * how that sweep silently starts passing vacuously.
 */
const TABLE_ONLY_ENV_REF = '{{TABLE_ONLY_TOKEN}}'

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
      apiCall: {
        id: 'apiCall',
        type: 'api',
        name: 'Call',
        position: { x: 400, y: 200 },
        subBlocks: {
          url: { id: 'url', type: 'short-input', value: 'https://example.com/v1/items' },
          headers: {
            id: 'headers',
            type: 'table',
            value: [
              { id: 'r1', cells: { Key: 'Content-Type', Value: 'application/json' } },
              { id: 'r2', cells: { Key: 'Authorization', Value: TABLE_ONLY_ENV_REF } },
            ],
          },
          params: {
            id: 'params',
            type: 'table',
            value: [{ id: 'r3', cells: { Key: 'limit', Value: '10' } }],
          },
        },
        outputs: {},
        enabled: true,
      },
      agent: {
        id: 'agent',
        type: 'agent',
        name: 'Agent',
        position: { x: 600, y: 200 },
        subBlocks: {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              {
                type: 'custom-tool',
                title: 'My Tool',
                params: { endpoint: 'https://example.com/hook', greeting: 'hi' },
              },
            ],
          },
        },
        outputs: {},
        enabled: true,
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
  const exportedJson = JSON.stringify(exported)
  const { data: reimported, errors } = parseWorkflowJson(exportedJson)

  it('re-imports without validation errors', () => {
    expect(errors).toEqual([])
    expect(reimported).not.toBeNull()
  })

  it('preserves every block, including children inside loop and parallel containers', () => {
    expect(Object.keys(exported.state.blocks).sort()).toEqual([
      'agent',
      'apiCall',
      'childInLoop',
      'childInPar',
      'loop1',
      'par1',
      'starter',
    ])
    expect(Object.keys(reimported!.blocks)).toHaveLength(7)
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

  /**
   * The round trip is deliberately NOT lossless, and these assertions exist so that stops being a
   * surprise. `sanitizeForExport` passes `redactOpaqueCredentialInputs`, which withholds whole
   * `table` values and every parameter of a tool with no authoritative codec metadata — see the
   * trade recorded on `OPAQUE_CREDENTIAL_BEARING_TYPES` in `credential-extractor`.
   *
   * Both classes carry secrets no per-field rule can find (a bearer token pasted into a header
   * cell, a key in a custom tool's params) and both also carry ordinary configuration, which goes
   * with them. Whoever revisits that trade has to edit these expectations, which is the point: the
   * absence of a `table` fixture here is why the change reached a release unnoticed.
   */
  it('withholds table values, including whole {{ENV_VAR}} cells, on the way out', () => {
    const subBlocks = exported.state.blocks.apiCall.subBlocks as Record<string, { value: unknown }>

    expect(subBlocks.headers.value).toBeNull()
    expect(subBlocks.params.value).toBeNull()
    expect(subBlocks.url.value).toBe('https://example.com/v1/items')
    expect(exportedJson).not.toContain(TABLE_ONLY_ENV_REF)
  })

  it('withholds every parameter of a tool with no authoritative codec metadata', () => {
    const tools = exported.state.blocks.agent.subBlocks.tools.value as {
      params: Record<string, unknown>
    }[]

    expect(tools[0].params).toEqual({ endpoint: null, greeting: null })
    expect(tools[0].title).toBe('My Tool')
  })

  it('re-imports the withheld sub-blocks as empty rather than dropping or corrupting them', () => {
    const reimportedApi = Object.values(reimported!.blocks).find((b) => b.type === 'api')

    expect(reimportedApi).toBeDefined()
    expect(reimportedApi?.subBlocks.headers.value).toBeNull()
    expect(reimportedApi?.subBlocks.url.value).toBe('https://example.com/v1/items')
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
