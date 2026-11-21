import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, expect, it } from 'vitest'
import { SOURCE_LIMITS } from './limits'
import { parseSourceBase, parseWorkflowLock } from './lock'

function validLock(): Record<string, unknown> {
  return {
    version: 1,
    blocks: {
      start: { id: 'blk-start', parent: null, ident: 'start', order: 0 },
      each: { id: 'blk-each', parent: null, ident: 'each', order: 1 },
      route: {
        id: 'blk-route',
        parent: 'each',
        ident: 'route',
        order: 2,
        branches: { if: 'blk-route-if', else: 'blk-route-else' },
        items: {
          inputFormat: [
            { name: 'subject', id: 'field-1' },
            { name: '', id: 'field-2' },
            { name: 'subject', id: 'field-3' },
          ],
        },
        layout: { x: 10, y: -4.5, w: 200, horizontalHandles: true },
        codeFile: 'functions/route.js',
      },
    },
    variables: { retries: 'var-1' },
  }
}

function codesFor(input: unknown): string[] {
  const result = parseWorkflowLock(input)
  return result.diagnostics ? result.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`) : []
}

function withBlock(key: string, patch: Record<string, unknown>): Record<string, unknown> {
  const lock = validLock()
  const blocks = lock.blocks as Record<string, Record<string, unknown>>
  blocks[key] = { ...blocks[key], ...patch }
  return lock
}

describe('parseWorkflowLock', () => {
  it('accepts a well-formed lock, from an object or from JSON text', () => {
    const fromObject = parseWorkflowLock(validLock())
    expect(fromObject.diagnostics).toBeUndefined()
    expect(fromObject.lock?.blocks.route.branches).toEqual({
      if: 'blk-route-if',
      else: 'blk-route-else',
    })
    expect(parseWorkflowLock(JSON.stringify(validLock())).lock).toEqual(fromObject.lock)
  })

  it('keeps items with duplicate or empty names, in order', () => {
    expect(parseWorkflowLock(validLock()).lock?.blocks.route.items?.inputFormat).toEqual([
      { name: 'subject', id: 'field-1' },
      { name: '', id: 'field-2' },
      { name: 'subject', id: 'field-3' },
    ])
  })

  it('rejects text that is not JSON and values that are not objects', () => {
    expect(codesFor('{"version":')).toEqual(['E_LOCK_JSON '])
    expect(codesFor([])).toEqual(['E_LOCK_SHAPE '])
    expect(codesFor(null)).toEqual(['E_LOCK_SHAPE '])
  })

  it('rejects any lock version but 1 before reading the rest', () => {
    expect(codesFor({ ...validLock(), version: 2, blocks: 'nope' })).toEqual([
      'E_LOCK_VERSION /version',
    ])
  })

  it('reports every problem at once with JSON Pointer paths', () => {
    const lock = withBlock('route', { id: '', ident: 'class', order: -1 })
    lock.variables = { retries: 7 }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_SHAPE /blocks/route/id',
      'E_LOCK_IDENT /blocks/route/ident',
      'E_LOCK_SHAPE /blocks/route/order',
      'E_LOCK_SHAPE /variables/retries',
    ])
  })

  it('rejects fields the schema does not define, at every level', () => {
    const lock = withBlock('start', { alias: 'start' })
    lock.workflowId = 'wf-1'
    const route = (lock.blocks as Record<string, Record<string, unknown>>).route
    route.layout = { x: 1, y: 2, z: 3 }
    route.items = { inputFormat: [{ name: 'a', id: 'f', type: 'string' }] }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_UNKNOWN_FIELD /workflowId',
      'E_LOCK_UNKNOWN_FIELD /blocks/start/alias',
      'E_LOCK_UNKNOWN_FIELD /blocks/route/items/inputFormat/0/type',
      'E_LOCK_UNKNOWN_FIELD /blocks/route/layout/z',
    ])
  })

  it('tolerates and preserves x- extension fields at every object level', () => {
    const lock = withBlock('start', { 'x-note': { by: 'tool' } })
    lock['x-tool'] = 'v2'
    ;(lock.blocks as Record<string, Record<string, unknown>>).route.layout = {
      x: 1,
      y: 2,
      'x-snap': true,
    }
    const parsed = parseWorkflowLock(lock).lock
    expect(parsed?.['x-tool']).toBe('v2')
    expect(parsed?.blocks.start['x-note']).toEqual({ by: 'tool' })
    expect(parsed?.blocks.route.layout?.['x-snap']).toBe(true)
    expect(codesFor({ ...validLock(), 'x-bad': () => 1 })).toEqual(['E_LOCK_SHAPE /x-bad'])
  })

  it('requires block and variable keys in normalized form, including ~n collision keys', () => {
    const lock = validLock()
    const blocks = lock.blocks as Record<string, Record<string, unknown>>
    blocks['My Block'] = { id: 'blk-x', parent: null, ident: 'myBlock', order: 3 }
    blocks['start~2'] = { id: 'blk-start-2', parent: null, ident: 'start2', order: 4 }
    lock.variables = { 'Retry Count': 'var-2' }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_KEY /blocks/My Block',
      'E_LOCK_KEY /variables/Retry Count',
    ])
  })

  it('rejects idents that are not identifiers, are reserved, shadow the SDK, or repeat', () => {
    for (const ident of ['2fast', 'await', 'env', 'block', 't']) {
      expect(codesFor(withBlock('route', { ident })), ident).toEqual([
        'E_LOCK_IDENT /blocks/route/ident',
      ])
    }
    expect(codesFor(withBlock('route', { ident: 'start' }))).toEqual([
      'E_LOCK_DUPLICATE_IDENT /blocks/route/ident',
    ])
  })

  it('allows two blocks to share an order so merged locks stay valid', () => {
    expect(parseWorkflowLock(withBlock('route', { order: 0 })).diagnostics).toBeUndefined()
  })

  it('rejects an id used twice by blocks, variables, branches of one block, or items', () => {
    expect(codesFor(withBlock('route', { id: 'blk-start' }))).toEqual([
      'E_LOCK_DUPLICATE_ID /blocks/route/id',
    ])
    const vars = validLock()
    vars.variables = { a: 'var-1', b: 'var-1' }
    expect(codesFor(vars)).toEqual(['E_LOCK_DUPLICATE_ID /variables/b'])
    expect(codesFor(withBlock('route', { branches: { if: 'x', else: 'x' } }))).toEqual([
      'E_LOCK_DUPLICATE_ID /blocks/route/branches/else',
    ])
    expect(
      codesFor(
        withBlock('route', {
          items: {
            inputFormat: [
              { name: 'a', id: 'f' },
              { name: 'b', id: 'f' },
            ],
          },
        })
      )
    ).toEqual(['E_LOCK_DUPLICATE_ID /blocks/route/items/inputFormat/1/id'])
  })

  it('rejects parents that are missing, self-referential, or cyclic', () => {
    expect(codesFor(withBlock('route', { parent: 'nowhere' }))).toEqual([
      'E_LOCK_PARENT /blocks/route/parent',
    ])
    expect(codesFor(withBlock('route', { parent: 'route' }))).toEqual([
      'E_LOCK_PARENT /blocks/route/parent',
    ])
    expect(codesFor(withBlock('each', { parent: 'route' }))).toEqual([
      'E_LOCK_PARENT /blocks/each/parent',
      'E_LOCK_PARENT /blocks/route/parent',
    ])
  })

  it('reports only the blocks on a cycle, not the blocks that lead into one', () => {
    const lock = validLock()
    lock.blocks = {
      a: { id: 'a', parent: 'b', ident: 'a', order: 0 },
      b: { id: 'b', parent: 'a', ident: 'b', order: 1 },
      c: { id: 'c', parent: 'a', ident: 'c', order: 2 },
      d: { id: 'd', parent: 'c', ident: 'd', order: 3 },
    }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_PARENT /blocks/a/parent',
      'E_LOCK_PARENT /blocks/b/parent',
    ])
  })

  it('checks a long parent chain in linear time', () => {
    // 64 to 512 blocks, not the cap: a chain at the cap outgrows the CPU cache, which narrows the
    // gap between linear and quadratic growth.
    expectLinearGrowth((n) => {
      const blocks: Record<string, unknown> = {}
      for (let i = 0; i < n; i += 1) {
        blocks[`b${i}`] = {
          id: `id${i}`,
          parent: i === 0 ? null : `b${i - 1}`,
          ident: `b${i}`,
          order: i,
        }
      }
      const lock = { version: 1, blocks, variables: {} }
      return () => parseWorkflowLock(lock)
    }, 64)
  })

  it('refuses more blocks or variables than a workflow may hold, before reading them', () => {
    const blocks: Record<string, unknown> = {}
    const variables: Record<string, string> = {}
    // Each entry is malformed, so a reader that walked them would report far more than the cap.
    for (let i = 0; i <= SOURCE_LIMITS.maxBlocks; i += 1) blocks[`b${i}`] = { id: i }
    for (let i = 0; i <= SOURCE_LIMITS.maxVariables; i += 1) variables[`v${i}`] = ''
    expect(codesFor({ version: 1, blocks, variables: {} })).toEqual(['E_LOCK_SHAPE /blocks'])
    expect(codesFor({ version: 1, blocks: {}, variables })).toEqual(['E_LOCK_SHAPE /variables'])
    // An oversized variables record is refused without walking the malformed blocks beside it.
    const atCap = Object.fromEntries(Object.entries(blocks).slice(0, SOURCE_LIMITS.maxBlocks))
    expect(codesFor({ version: 1, blocks: atCap, variables })).toEqual(['E_LOCK_SHAPE /variables'])
  })

  it('rejects branch keys that are not identifiers', () => {
    expect(codesFor(withBlock('route', { branches: { 'else-if-1': 'x' } }))).toEqual([
      'E_LOCK_BRANCH /blocks/route/branches/else-if-1',
    ])
  })

  it('rejects code file paths that are absolute, escape the repo, or use backslashes', () => {
    for (const codeFile of ['/etc/x.js', '../x.js', 'a/../../x.js', 'fns\\x.js', 'C:/x.js', '']) {
      expect(codesFor(withBlock('route', { codeFile })), codeFile).toEqual([
        'E_LOCK_CODE_FILE_PATH /blocks/route/codeFile',
      ])
    }
  })

  it('rejects non-finite layout numbers and malformed item lists', () => {
    expect(
      codesFor(
        withBlock('route', {
          layout: { x: Number.NaN, y: 0 },
          items: { inputFormat: { subject: 'f' }, other: [{ name: 1, id: 'g' }] },
        })
      )
    ).toEqual([
      'E_LOCK_SHAPE /blocks/route/items/inputFormat',
      'E_LOCK_SHAPE /blocks/route/items/other/0/name',
      'E_LOCK_SHAPE /blocks/route/layout/x',
    ])
  })

  it('escapes ~ and / in pointer segments', () => {
    const lock = validLock()
    const blocks = lock.blocks as Record<string, Record<string, unknown>>
    blocks['a/b~2'] = { id: 'blk-ab', parent: null, ident: 'ab', order: 'x' }
    expect(codesFor(lock)).toEqual(['E_LOCK_SHAPE /blocks/a~1b~02/order'])
  })
})

describe('parseSourceBase', () => {
  const base = { workflowId: 'wf-1', workspaceId: 'ws-1', fingerprint: 'sf1:a', catalogHash: 'c' }

  it('reads a base written before it carried a version as version 1', () => {
    expect(parseSourceBase(JSON.stringify(base))).toEqual({ base: { version: 1, ...base } })
  })

  it('refuses a version this build cannot read', () => {
    expect(parseSourceBase({ ...base, version: 2 })).toEqual({
      problem: 'Unsupported base version; expected 1.',
    })
  })

  it('keeps an x- extension and refuses any other unknown field', () => {
    expect(parseSourceBase({ ...base, 'x-tool': { pinned: true } })).toEqual({
      base: { version: 1, ...base, 'x-tool': { pinned: true } },
    })
    expect(parseSourceBase({ ...base, branch: 'main' })).toEqual({
      problem: 'Unknown base field "branch".',
    })
  })

  it('names every missing or malformed field at once', () => {
    expect(parseSourceBase({ workspaceId: 1, fingerprint: 'x'.repeat(257) })).toEqual({
      problem:
        '"workflowId" must be a non-empty string. "workspaceId" must be a string. "fingerprint" must be a non-empty string of at most 256 characters. "catalogHash" must be a string.',
    })
  })
})
