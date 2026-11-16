import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeAnchor, encodeAnchor } from './anchors'
import {
  codeMetaEquals,
  parseCodeMeta,
  pruneCodeMeta,
  remapCodeMeta,
  type WorkflowCodeMetaV1,
} from './code-meta'
import type { Anchor, AnchorKey, CodeComment } from './model'

const line = (text: string): CodeComment => ({ text, kind: 'line', placement: 'leading' })

function validMeta(): Record<string, unknown> {
  return {
    v: 1,
    bindings: { 'blk-a': 'fetchUser', 'blk-b': 'route' },
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
  const result = parseCodeMeta(input)
  return result.diagnostics ? result.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`) : []
}

function parsed(input: unknown): WorkflowCodeMetaV1 {
  const result = parseCodeMeta(input)
  if (!result.meta) throw new Error(codesFor(input).join(', '))
  return result.meta
}

describe('parseCodeMeta', () => {
  it('accepts a well-formed value from an object or JSON text and keeps x- fields', () => {
    const meta = parsed(validMeta())
    expect(meta['x-future']).toEqual({ anything: [1, 'two'] })
    expect(parsed(JSON.stringify(validMeta()))).toEqual(meta)
  })

  it('stops at an unsupported version and at text that is not JSON', () => {
    expect(codesFor({ ...validMeta(), v: 2, bindings: 'nope' })).toEqual(['E_CODE_META_VERSION /v'])
    expect(codesFor('{"v":1,')).toEqual(['E_CODE_META_JSON '])
    expect(codesFor([])).toEqual(['E_CODE_META_SHAPE '])
  })

  it('rejects bindings that would not compile: non-identifiers, reserved names, duplicates', () => {
    expect(
      codesFor({
        ...validMeta(),
        bindings: { a: 'two words', b: 'workflow', c: 'class', d: 'same', e: 'same' },
      })
    ).toEqual([
      'E_CODE_META_BINDING /bindings/a',
      'E_CODE_META_BINDING /bindings/b',
      'E_CODE_META_BINDING /bindings/c',
      'E_CODE_META_DUPLICATE_BINDING /bindings/e',
    ])
  })

  it('reports every problem at once with a JSON pointer, escaping ~ and /', () => {
    expect(
      codesFor({
        v: 1,
        bindings: {},
        order: { 'a/b': -1, 'c~d': 1.5 },
        comments: { 'block:x': [{ text: 1, kind: 'line', placement: 'leading' }] },
        typo: true,
      })
    ).toEqual([
      'E_CODE_META_UNKNOWN_FIELD /typo',
      'E_CODE_META_SHAPE /order/a~1b',
      'E_CODE_META_SHAPE /order/c~0d',
      'E_CODE_META_SHAPE /comments/block:x/0/text',
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
      'E_CODE_META_ANCHOR /comments/nowhere:x',
      'E_CODE_META_ANCHOR /comments/block:a%zz',
      'E_CODE_META_ANCHOR /comments/edges:a:nonsense',
      'E_CODE_META_ANCHOR /comments/block:a:b',
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
      'E_CODE_META_SHAPE /comments/header/0/kind',
      'E_CODE_META_SHAPE /comments/header/1/placement',
      'E_CODE_META_UNKNOWN_FIELD /comments/header/2/color',
    ])
  })
})

describe('pruneCodeMeta and remapCodeMeta', () => {
  it('prunes every entry of a deleted block or variable and keeps id-free anchors', () => {
    const meta = parsed(validMeta())
    const pruned = pruneCodeMeta(meta, {
      blocks: (id) => id !== 'blk-b',
      variables: () => false,
    })
    expect(pruned.bindings).toEqual({ 'blk-a': 'fetchUser' })
    expect(pruned.order).toEqual({ 'blk-a': 0 })
    expect(Object.keys(pruned.comments).sort()).toEqual(['block:blk-a', 'header'])
    expect(pruned['x-future']).toEqual(meta['x-future'])
  })

  it('remaps ids onto a copy and drops ids the copy did not take', () => {
    const meta = parsed(validMeta())
    const copy = remapCodeMeta(meta, new Map([['blk-a', 'new-a']]), new Map([['var-1', 'v-2']]))
    expect(copy.bindings).toEqual({ 'new-a': 'fetchUser' })
    expect(copy.order).toEqual({ 'new-a': 0 })
    expect(Object.keys(copy.comments).sort()).toEqual(['block:new-a', 'header', 'var:v-2'])
  })

  it('keeps one binding when two ids collapse onto one', () => {
    const meta = parsed(validMeta())
    const merged = remapCodeMeta(
      meta,
      new Map([
        ['blk-a', 'same'],
        ['blk-b', 'same'],
      ]),
      new Map()
    )
    expect(merged.bindings).toEqual({ same: 'fetchUser' })
    expect(parseCodeMeta(merged).diagnostics).toBeUndefined()
  })
})

const idArb = fc.stringMatching(/^[a-z0-9:%-]{1,8}$/)
const identifierArb = fc
  .stringMatching(/^[a-z][A-Za-z0-9]{0,6}$/)
  .filter(
    (s) => parseCodeMeta({ v: 1, bindings: { x: s }, order: {}, comments: {} }).meta !== undefined
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
  meta: WorkflowCodeMetaV1
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
        bindings: fc.uniqueArray(identifierArb, {
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
      .map(({ bindings, order, comments }) => {
        const meta: WorkflowCodeMetaV1 = {
          v: 1,
          bindings: Object.fromEntries(blockIds.map((id, i) => [id, bindings[i] ?? 'b'])),
          order: Object.fromEntries(blockIds.map((id, i) => [id, order[i] ?? 0])),
          comments: {},
        }
        for (const [anchor, list] of comments) meta.comments[encodeAnchor(anchor)] = list
        return { meta, blockIds, variableIds }
      })
  )

function mentionedIds(meta: WorkflowCodeMetaV1): Set<string> {
  const ids = new Set([...Object.keys(meta.bindings), ...Object.keys(meta.order)])
  for (const key of Object.keys(meta.comments)) {
    const anchor = decodeAnchor(key as AnchorKey)
    if (anchor && 'block' in anchor) ids.add(anchor.block)
    if (anchor?.kind === 'var') ids.add(anchor.variable)
  }
  return ids
}

describe('code_meta properties', () => {
  it('every generated value parses back to itself', () => {
    fc.assert(
      fc.property(metaArb, ({ meta }) => {
        expect(codeMetaEquals(parsed(JSON.parse(JSON.stringify(meta))), meta)).toBe(true)
      })
    )
  })

  it('a remap through a bijection and back is the identity, and every remap parses', () => {
    fc.assert(
      fc.property(metaArb, ({ meta, blockIds, variableIds }) => {
        const forward = new Map(blockIds.map((id, i) => [id, `copy-${i}`]))
        const vars = new Map(variableIds.map((id, i) => [id, `copyvar-${i}`]))
        const copy = remapCodeMeta(meta, forward, vars)
        expect(parseCodeMeta(copy).diagnostics).toBeUndefined()
        const back = remapCodeMeta(
          copy,
          new Map([...forward].map(([a, b]) => [b, a])),
          new Map([...vars].map(([a, b]) => [b, a]))
        )
        expect(codeMetaEquals(back, meta)).toBe(true)
      })
    )
  })

  it('pruning leaves no entry that mentions a removed id and keeps every live one', () => {
    fc.assert(
      fc.property(metaArb, fc.integer({ min: 0, max: 5 }), ({ meta, blockIds }, drop) => {
        const removed = blockIds[drop % blockIds.length]
        const pruned = pruneCodeMeta(meta, { blocks: (id) => id !== removed })
        expect(mentionedIds(pruned).has(removed)).toBe(false)
        expect(codeMetaEquals(pruneCodeMeta(meta, { blocks: () => true }), meta)).toBe(true)
        for (const id of blockIds) {
          if (id !== removed) expect(pruned.bindings[id]).toBe(meta.bindings[id])
        }
      })
    )
  })
})
