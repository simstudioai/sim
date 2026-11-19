import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeAnchor, encodeAnchor } from './anchors'
import type { Anchor, AnchorKey, CodeComment } from './model'
import {
  parseSourceMeta,
  pruneSourceMeta,
  remapSourceMeta,
  sourceMetaEquals,
  type WorkflowSourceMetaV1,
} from './source-meta'

const line = (text: string): CodeComment => ({ text, kind: 'line', placement: 'leading' })

function validMeta(): Record<string, unknown> {
  return {
    version: 1,
    idents: { 'blk-a': 'fetchUser', 'blk-b': 'route' },
    order: { 'blk-a': 0, 'blk-b': 1 },
    comments: {
      header: [line(' file header')],
      [encodeAnchor({ kind: 'block', block: 'blk-a' })]: [line(' fetches the user')],
      [encodeAnchor({ kind: 'edges', block: 'blk-b', port: 'branch:else' })]: [
        { text: ' fallback ', kind: 'block', placement: 'trailing' },
      ],
      [encodeAnchor({ kind: 'var', variable: 'var-1' })]: [line(' retries')],
    },
    'x-future': { anything: [1, 'two'] },
  }
}

function codesFor(input: unknown): string[] {
  const result = parseSourceMeta(input)
  return result.diagnostics ? result.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`) : []
}

function parsed(input: unknown): WorkflowSourceMetaV1 {
  const result = parseSourceMeta(input)
  if (!result.meta) throw new Error(codesFor(input).join(', '))
  return result.meta
}

describe('parseSourceMeta', () => {
  it('accepts a well-formed value from an object or JSON text and keeps x- fields', () => {
    const meta = parsed(validMeta())
    expect(meta['x-future']).toEqual({ anything: [1, 'two'] })
    expect(parsed(JSON.stringify(validMeta()))).toEqual(meta)
  })

  it('stops at an unsupported version and at text that is not JSON', () => {
    expect(codesFor({ ...validMeta(), version: 2, idents: 'nope' })).toEqual([
      'E_SOURCE_META_VERSION /version',
    ])
    expect(codesFor('{"version":1,')).toEqual(['E_SOURCE_META_JSON '])
    expect(codesFor([])).toEqual(['E_SOURCE_META_SHAPE '])
  })

  it('rejects idents that would not compile: non-identifiers, reserved names, duplicates', () => {
    expect(
      codesFor({
        ...validMeta(),
        idents: { a: 'two words', b: 'workflow', c: 'class', d: 'same', e: 'same' },
      })
    ).toEqual([
      'E_SOURCE_META_IDENT /idents/a',
      'E_SOURCE_META_IDENT /idents/b',
      'E_SOURCE_META_IDENT /idents/c',
      'E_SOURCE_META_DUPLICATE_IDENT /idents/e',
    ])
  })

  it('reports every problem at once with a JSON pointer, escaping ~ and /', () => {
    expect(
      codesFor({
        version: 1,
        idents: {},
        order: { 'a/b': -1, 'c~d': 1.5 },
        comments: { 'block:x': [{ text: 1, kind: 'line', placement: 'leading' }] },
        typo: true,
      })
    ).toEqual([
      'E_SOURCE_META_UNKNOWN_FIELD /typo',
      'E_SOURCE_META_SHAPE /order/a~1b',
      'E_SOURCE_META_SHAPE /order/c~0d',
      'E_SOURCE_META_SHAPE /comments/block:x/0/text',
    ])
  })

  it('rejects anchors decodeAnchor refuses or that are not in canonical encoding', () => {
    expect(
      codesFor({
        ...validMeta(),
        comments: {
          'nowhere:x': [line('a')],
          'block:a%zz': [line('b')],
          'edges:a:nonsense': [line('c')],
          'block:a:b': [line('d')],
        },
      })
    ).toEqual([
      'E_SOURCE_META_ANCHOR /comments/nowhere:x',
      'E_SOURCE_META_ANCHOR /comments/block:a%zz',
      'E_SOURCE_META_ANCHOR /comments/edges:a:nonsense',
      'E_SOURCE_META_ANCHOR /comments/block:a:b',
    ])
  })

  it('rejects comments with an unknown field, kind or placement', () => {
    expect(
      codesFor({
        ...validMeta(),
        comments: {
          header: [
            { text: 'a', kind: 'doc', placement: 'leading' },
            { text: 'b', kind: 'line', placement: 'above' },
            { text: 'c', kind: 'line', placement: 'leading', color: 'red' },
          ],
        },
      })
    ).toEqual([
      'E_SOURCE_META_SHAPE /comments/header/0/kind',
      'E_SOURCE_META_SHAPE /comments/header/1/placement',
      'E_SOURCE_META_UNKNOWN_FIELD /comments/header/2/color',
    ])
  })
})

describe('pruneSourceMeta and remapSourceMeta', () => {
  it('prunes every entry of a deleted block or variable and keeps id-free anchors', () => {
    const meta = parsed(validMeta())
    const pruned = pruneSourceMeta(meta, {
      blocks: (id) => id !== 'blk-b',
      variables: () => false,
    })
    expect(pruned.idents).toEqual({ 'blk-a': 'fetchUser' })
    expect(pruned.order).toEqual({ 'blk-a': 0 })
    expect(Object.keys(pruned.comments).sort()).toEqual(['block:blk-a', 'header'])
    expect(pruned['x-future']).toEqual(meta['x-future'])
  })

  it('remaps ids onto a copy and drops ids the copy did not take', () => {
    const meta = parsed(validMeta())
    const copy = remapSourceMeta(meta, new Map([['blk-a', 'new-a']]), new Map([['var-1', 'v-2']]))
    expect(copy.idents).toEqual({ 'new-a': 'fetchUser' })
    expect(copy.order).toEqual({ 'new-a': 0 })
    expect(Object.keys(copy.comments).sort()).toEqual(['block:new-a', 'header', 'var:v-2'])
  })

  it('remaps a block id onto __proto__ as data', () => {
    const meta = parsed(validMeta())
    const copy = remapSourceMeta(meta, new Map([['blk-a', '__proto__']]), new Map())
    expect(Object.keys(copy.idents)).toEqual(['__proto__'])
    expect(Object.getOwnPropertyDescriptor(copy.idents, '__proto__')?.value).toBe('fetchUser')
    expect(Object.getOwnPropertyDescriptor(copy.order, '__proto__')?.value).toBe(0)
    expect(parseSourceMeta(copy).diagnostics).toBeUndefined()
  })

  it('keeps one ident when two ids collapse onto one', () => {
    const meta = parsed(validMeta())
    const merged = remapSourceMeta(
      meta,
      new Map([
        ['blk-a', 'same'],
        ['blk-b', 'same'],
      ]),
      new Map()
    )
    expect(merged.idents).toEqual({ same: 'fetchUser' })
    expect(parseSourceMeta(merged).diagnostics).toBeUndefined()
  })
})

const idArb = fc.stringMatching(/^[a-z0-9:%-]{1,8}$/)
const identifierArb = fc
  .stringMatching(/^[a-z][A-Za-z0-9]{0,6}$/)
  .filter(
    (s) =>
      parseSourceMeta({ version: 1, idents: { x: s }, order: {}, comments: {} }).meta !== undefined
  )
const commentArb: fc.Arbitrary<CodeComment> = fc.record({
  text: fc.string(),
  kind: fc.constantFrom('line' as const, 'block' as const),
  placement: fc.constantFrom('leading' as const, 'trailing' as const),
})

function anchorArb(blockIds: string[], variableIds: string[]): fc.Arbitrary<Anchor> {
  const block = fc.constantFrom(...blockIds)
  const options: fc.Arbitrary<Anchor>[] = [
    fc.constantFrom<Anchor>({ kind: 'header' }, { kind: 'wiring' }, { kind: 'footer' }),
    block.map((b): Anchor => ({ kind: 'block', block: b })),
    fc.tuple(block, idArb).map(([b, p]): Anchor => ({ kind: 'param', block: b, param: p })),
    fc
      .tuple(block, idArb)
      .map(([b, k]): Anchor => ({ kind: 'edges', block: b, port: `branch:${k}` })),
  ]
  if (variableIds.length > 0) {
    options.push(fc.constantFrom(...variableIds).map((v): Anchor => ({ kind: 'var', variable: v })))
  }
  return fc.oneof(...options)
}

const metaArb: fc.Arbitrary<{
  meta: WorkflowSourceMetaV1
  blockIds: string[]
  variableIds: string[]
}> = fc
  .record({
    blockIds: fc.uniqueArray(idArb, { minLength: 1, maxLength: 6 }),
    variableIds: fc.uniqueArray(idArb, { maxLength: 3 }),
  })
  .chain(({ blockIds, variableIds }) =>
    fc
      .record({
        idents: fc.uniqueArray(identifierArb, {
          minLength: blockIds.length,
          maxLength: blockIds.length,
        }),
        order: fc.array(fc.nat(50), { minLength: blockIds.length, maxLength: blockIds.length }),
        comments: fc.array(
          fc.tuple(
            anchorArb(blockIds, variableIds),
            fc.array(commentArb, { minLength: 1, maxLength: 2 })
          ),
          { maxLength: 6 }
        ),
      })
      .map(({ idents, order, comments }) => {
        const meta: WorkflowSourceMetaV1 = {
          version: 1,
          idents: Object.fromEntries(blockIds.map((id, i) => [id, idents[i] ?? 'b'])),
          order: Object.fromEntries(blockIds.map((id, i) => [id, order[i] ?? 0])),
          comments: {},
        }
        for (const [anchor, list] of comments) meta.comments[encodeAnchor(anchor)] = list
        return { meta, blockIds, variableIds }
      })
  )

/**
 * The block ids `meta` mentions. Variable ids are a separate namespace (`var:` anchors), so a
 * variable that shares a removed block's id is not a mention of that block.
 */
function mentionedBlockIds(meta: WorkflowSourceMetaV1): Set<string> {
  const ids = new Set([...Object.keys(meta.idents), ...Object.keys(meta.order)])
  for (const key of Object.keys(meta.comments)) {
    const anchor = decodeAnchor(key as AnchorKey)
    if (anchor && 'block' in anchor) ids.add(anchor.block)
  }
  return ids
}

describe('source meta properties', () => {
  it('every generated value parses back to itself', () => {
    fc.assert(
      fc.property(metaArb, ({ meta }) => {
        expect(sourceMetaEquals(parsed(JSON.stringify(meta)), meta)).toBe(true)
      })
    )
  })

  it('a remap through a bijection and back is the identity, and every remap parses', () => {
    fc.assert(
      fc.property(metaArb, ({ meta, blockIds, variableIds }) => {
        const forward = new Map(blockIds.map((id, i) => [id, `copy-${i}`]))
        const vars = new Map(variableIds.map((id, i) => [id, `copyvar-${i}`]))
        const copy = remapSourceMeta(meta, forward, vars)
        expect(parseSourceMeta(copy).diagnostics).toBeUndefined()
        const back = remapSourceMeta(
          copy,
          new Map([...forward].map(([a, b]) => [b, a])),
          new Map([...vars].map(([a, b]) => [b, a]))
        )
        expect(sourceMetaEquals(back, meta)).toBe(true)
      })
    )
  })

  it('pruning leaves no entry that mentions a removed block and keeps every live one', () => {
    fc.assert(
      fc.property(metaArb, fc.integer({ min: 0, max: 5 }), ({ meta, blockIds }, drop) => {
        const removed = blockIds[drop % blockIds.length]
        const pruned = pruneSourceMeta(meta, { blocks: (id) => id !== removed })
        expect(mentionedBlockIds(pruned).has(removed)).toBe(false)
        expect(sourceMetaEquals(pruneSourceMeta(meta, { blocks: () => true }), meta)).toBe(true)
        for (const id of blockIds) {
          if (id !== removed) expect(pruned.idents[id]).toBe(meta.idents[id])
        }
        for (const key of Object.keys(meta.comments) as AnchorKey[]) {
          if (decodeAnchor(key)?.kind === 'var') {
            expect(pruned.comments[key]).toEqual(meta.comments[key])
          }
        }
      })
    )
  })
})
