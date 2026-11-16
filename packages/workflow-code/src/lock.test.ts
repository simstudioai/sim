import { describe, expect, it } from 'vitest'
import { parseWorkflowLock } from './lock'

const HASH = 'a'.repeat(64)

function validLock(): Record<string, unknown> {
  return {
    lockVersion: 1,
    workflowId: 'wf-1',
    workspaceId: 'ws-1',
    catalogHash: 'cat-1',
    baseFingerprint: `sf1:${'b'.repeat(64)}`,
    blocks: {
      start: {
        id: 'blk-start',
        type: 'start_trigger',
        name: 'Start',
        binding: 'start',
        order: 0,
        parent: null,
        contentHash: HASH,
      },
      each: {
        id: 'blk-each',
        type: 'loop',
        name: 'Each',
        binding: 'each',
        order: 1,
        parent: null,
        contentHash: HASH,
      },
      route: {
        id: 'blk-route',
        type: 'condition',
        name: 'Route',
        binding: 'route',
        order: 2,
        parent: 'each',
        contentHash: HASH,
        branches: { if: 'blk-route-if', else: 'blk-route-else' },
        items: { inputFormat: { subject: 'field-1' } },
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

  it('rejects text that is not JSON and values that are not objects', () => {
    expect(codesFor('{"lockVersion":')).toEqual(['E_LOCK_JSON '])
    expect(codesFor([])).toEqual(['E_LOCK_SHAPE '])
    expect(codesFor(null)).toEqual(['E_LOCK_SHAPE '])
  })

  it('rejects any lock version but 1 before reading the rest', () => {
    expect(codesFor({ ...validLock(), lockVersion: 2, blocks: 'nope' })).toEqual([
      'E_LOCK_VERSION /lockVersion',
    ])
  })

  it('reports every problem at once with JSON Pointer paths', () => {
    const lock = withBlock('route', { binding: 'class', order: -1, contentHash: 'xyz' })
    lock.workflowId = ''
    lock.baseFingerprint = 'abc'
    expect(codesFor(lock)).toEqual([
      'E_LOCK_SHAPE /workflowId',
      'E_LOCK_SHAPE /baseFingerprint',
      'E_LOCK_BINDING /blocks/route/binding',
      'E_LOCK_SHAPE /blocks/route/order',
      'E_LOCK_SHAPE /blocks/route/contentHash',
    ])
  })

  it('rejects fields the schema does not define, at every level', () => {
    const lock = withBlock('start', { ident: 'start' })
    lock.edges = {}
    ;(lock.blocks as Record<string, Record<string, unknown>>).route.layout = { x: 1, y: 2, z: 3 }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_UNKNOWN_FIELD /edges',
      'E_LOCK_UNKNOWN_FIELD /blocks/start/ident',
      'E_LOCK_UNKNOWN_FIELD /blocks/route/layout/z',
    ])
  })

  it('requires keys in normalized form and matching their block name', () => {
    const lock = validLock()
    const blocks = lock.blocks as Record<string, Record<string, unknown>>
    blocks['My Block'] = { ...blocks.start, id: 'blk-x', binding: 'myBlock', name: 'My Block' }
    blocks.start.name = 'Begin'
    lock.variables = { 'Retry Count': 'var-2' }
    expect(codesFor(lock)).toEqual([
      'E_LOCK_KEY /blocks/start/name',
      'E_LOCK_KEY /blocks/My Block',
      'E_LOCK_KEY /variables/Retry Count',
    ])
  })

  it('accepts the ~n key a legacy name collision is projected to', () => {
    const lock = validLock()
    const blocks = lock.blocks as Record<string, Record<string, unknown>>
    blocks['start~2'] = { ...blocks.start, id: 'blk-start-2', binding: 'start2', order: 3 }
    expect(parseWorkflowLock(lock).diagnostics).toBeUndefined()
  })

  it('rejects bindings that are not identifiers or that two blocks share', () => {
    expect(codesFor(withBlock('route', { binding: '2fast' }))).toEqual([
      'E_LOCK_BINDING /blocks/route/binding',
    ])
    expect(codesFor(withBlock('route', { binding: 'await' }))).toEqual([
      'E_LOCK_BINDING /blocks/route/binding',
    ])
    expect(codesFor(withBlock('route', { binding: 'start' }))).toEqual([
      'E_LOCK_DUPLICATE_BINDING /blocks/route/binding',
    ])
  })

  it('allows two blocks to share an order so merged locks stay valid', () => {
    expect(parseWorkflowLock(withBlock('route', { order: 0 })).diagnostics).toBeUndefined()
  })

  it('rejects an id used by two blocks, two variables, or two branches of one block', () => {
    expect(codesFor(withBlock('route', { id: 'blk-start' }))).toEqual([
      'E_LOCK_DUPLICATE_ID /blocks/route/id',
    ])
    const vars = validLock()
    vars.variables = { a: 'var-1', b: 'var-1' }
    expect(codesFor(vars)).toEqual(['E_LOCK_DUPLICATE_ID /variables/b'])
    expect(codesFor(withBlock('route', { branches: { if: 'x', else: 'x' } }))).toEqual([
      'E_LOCK_DUPLICATE_ID /blocks/route/branches/else',
    ])
  })

  it('rejects parents that are missing, self-referential, or cyclic', () => {
    expect(codesFor(withBlock('route', { parent: 'nowhere' }))).toEqual([
      'E_LOCK_PARENT /blocks/route/parent',
    ])
    expect(codesFor(withBlock('route', { parent: 'route' }))).toEqual([
      'E_LOCK_PARENT /blocks/route/parent',
    ])
    const cyclic = withBlock('each', { parent: 'route' })
    expect(codesFor(cyclic)).toEqual([
      'E_LOCK_PARENT /blocks/each/parent',
      'E_LOCK_PARENT /blocks/route/parent',
    ])
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

  it('rejects non-finite layout numbers and malformed item maps', () => {
    expect(
      codesFor(withBlock('route', { layout: { x: Number.NaN, y: 0 }, items: { inputFormat: [] } }))
    ).toEqual([
      'E_LOCK_SHAPE /blocks/route/items/inputFormat',
      'E_LOCK_SHAPE /blocks/route/layout/x',
    ])
  })

  it('escapes ~ and / in pointer segments', () => {
    const lock = validLock()
    const blocks = lock.blocks as Record<string, Record<string, unknown>>
    blocks['a/b~2'] = { ...blocks.start, id: 'blk-ab', binding: 'ab', name: 'a/b', order: 'x' }
    expect(codesFor(lock)).toEqual(['E_LOCK_SHAPE /blocks/a~1b~02/order'])
  })
})
