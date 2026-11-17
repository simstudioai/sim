import { describe, expect, it } from 'vitest'
import { encodeAnchor } from '../anchors'
import { compareEdges } from '../canonicalize/edges'
import { sha256Hex, stableStringify } from '../hash'
import type { LockIdentity } from '../lock'
import type { CanonicalBlock, CanonicalWorkflow, CodeComment } from '../model'
import { canonicalDigests, canonicalEquals, canonicalHash, sourceFingerprint } from '.'

function codeBlock(key: string, overrides: Partial<CanonicalBlock> = {}): CanonicalBlock {
  return {
    key,
    name: key,
    type: 'function',
    parent: null,
    enabled: true,
    locked: false,
    triggerMode: false,
    advancedMode: false,
    errorPort: false,
    retry: null,
    params: { code: { kind: 'value', value: { body: 'return 1', options: { a: 1, b: [1, 2] } } } },
    modes: {},
    ...overrides,
  }
}

function base(): CanonicalWorkflow {
  return {
    modelVersion: 1,
    meta: { name: 'W', description: null },
    blocks: { a: codeBlock('a'), b: codeBlock('b') },
    edges: [
      { from: 'a', port: { kind: 'error' }, to: 'b' },
      { from: 'a', port: { kind: 'out' }, to: 'b' },
    ],
    variables: { v: { key: 'v', name: 'V', type: 'string', value: 'x' } },
    annotations: { comments: {} },
  }
}

/** The same CWM with every object's keys reversed, as jsonb may hand them back. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, member]) => [key, reverseKeys(member)])
  ) as T
}

const IDENTITY: LockIdentity = {
  blocks: { a: { id: 'id-a', parent: null }, b: { id: 'id-b', parent: null } },
  variables: { v: 'var-1' },
}

const LINE: CodeComment = { text: ' note', kind: 'line', placement: 'leading' }

describe('canonicalEquals and canonicalHash', () => {
  it('ignore key order at every depth', () => {
    const reordered = reverseKeys(base())
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(base()))
    expect(canonicalEquals(base(), reordered)).toBe(true)
    expect(canonicalHash(reordered)).toBe(canonicalHash(base()))
  })

  it('ignore edge order', () => {
    const swapped = base()
    swapped.edges.reverse()
    expect(canonicalEquals(base(), swapped)).toBe(true)
    expect(canonicalHash(swapped)).toBe(canonicalHash(base()))
  })

  it('ignore annotations', () => {
    const annotated = base()
    annotated.annotations.comments = { [encodeAnchor({ kind: 'block', block: 'a' })]: [LINE] }
    expect(canonicalEquals(base(), annotated)).toBe(true)
    expect(canonicalHash(annotated)).toBe(canonicalHash(base()))
  })

  it('treat an undefined optional field as absent', () => {
    const explicit = base()
    explicit.blocks.a = { ...explicit.blocks.a, branches: undefined }
    expect(canonicalEquals(base(), explicit)).toBe(true)
    expect(canonicalHash(explicit)).toBe(canonicalHash(base()))
  })

  it('see every semantic difference, including array order, empty string vs absence, and types', () => {
    const changes: Array<(w: CanonicalWorkflow) => void> = [
      (w) => {
        w.blocks.a.params.code = {
          kind: 'value',
          value: { body: 'return 2', options: { a: 1, b: [1, 2] } },
        }
      },
      (w) => {
        w.blocks.a.params.code = {
          kind: 'value',
          value: { body: 'return 1', options: { a: 1, b: [2, 1] } },
        }
      },
      (w) => {
        w.blocks.a.params.extra = { kind: 'value', value: '' }
      },
      (w) => {
        w.blocks.a.params.code = { kind: 'value', value: '1' }
      },
      (w) => {
        w.blocks.a.locked = true
      },
      (w) => {
        w.edges.pop()
      },
      (w) => {
        w.edges[0] = { from: 'a', port: { kind: 'raw', handle: 'error' }, to: 'b' }
      },
      (w) => {
        w.variables.v.value = 'y'
      },
      (w) => {
        w.meta.description = ''
      },
    ]
    for (const change of changes) {
      const changed = base()
      change(changed)
      expect(canonicalEquals(base(), changed)).toBe(false)
      expect(canonicalHash(changed)).not.toBe(canonicalHash(base()))
    }
  })
})

describe('sourceFingerprint', () => {
  it('is stable under key and edge order', () => {
    const fingerprint = sourceFingerprint(base(), IDENTITY)
    const reordered = reverseKeys(base())
    reordered.edges.reverse()
    expect(sourceFingerprint(reordered, reverseKeys(IDENTITY))).toBe(fingerprint)
  })

  it('ignores annotations but changes with any id, locked flag or variable', () => {
    const fingerprint = sourceFingerprint(base(), IDENTITY)
    const annotated = base()
    annotated.annotations.comments = { [encodeAnchor({ kind: 'block', block: 'a' })]: [LINE] }
    expect(sourceFingerprint(annotated, IDENTITY)).toBe(fingerprint)

    const reId: LockIdentity = {
      ...IDENTITY,
      blocks: { ...IDENTITY.blocks, a: { id: 'id-z', parent: null } },
    }
    expect(sourceFingerprint(base(), reId)).not.toBe(fingerprint)
    expect(sourceFingerprint(base(), { ...IDENTITY, variables: { v: 'var-2' } })).not.toBe(
      fingerprint
    )
    const locked = base()
    locked.blocks.b.locked = true
    expect(sourceFingerprint(locked, IDENTITY)).not.toBe(fingerprint)
  })

  it('hashes stableStringify({ workflow, identity }) of the semantic workflow, as canonicalDigests does', () => {
    const { annotations, ...semantic } = base()
    semantic.edges = [...semantic.edges].sort(compareEdges)
    const expected = `sf1:${sha256Hex(stableStringify({ workflow: semantic, identity: IDENTITY }))}`
    expect(sourceFingerprint(base(), IDENTITY)).toBe(expected)
    expect(canonicalDigests(base(), IDENTITY)).toEqual({
      canonicalHash: canonicalHash(base()),
      fingerprint: expected,
    })
  })
})
