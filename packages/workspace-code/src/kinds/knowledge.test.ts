import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'
import { type KnowledgeBaseDecl, type KnowledgeChunkingDecl, knowledgeCodec } from './knowledge'

type Recipe = NonNullable<NonNullable<KnowledgeChunkingDecl['strategyOptions']>['recipe']>

const text = fc.string({ maxLength: 40 }).filter((value) => !/[\u0000\ud800-\udfff]/.test(value))
const sha256 = fc.stringMatching(/^[0-9a-f]{64}$/)
const docName = fc.oneof(
  fc
    .stringMatching(/^[A-Za-z0-9_][A-Za-z0-9 _.()-]{0,30}$/)
    .filter(
      (value) => !/[ .]$/.test(value) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(value)
    ),
  fc.constantFrom('__proto__', 'constructor', 'notes.md', 'Ünïcödé.txt')
)

const knowledgeBase: fc.Arbitrary<KnowledgeBaseDecl> = fc.record(
  {
    name: text.filter((value) => value.length > 0),
    description: text,
    folder: text.map((value) => `/${value}`),
    chunking: fc.record(
      {
        maxSize: fc.nat(4000),
        minSize: fc.nat(2000),
        overlap: fc.nat(500),
        strategy: fc.constantFrom<NonNullable<KnowledgeChunkingDecl['strategy']>>(
          'auto',
          'text',
          'regex',
          'recursive',
          'sentence',
          'token'
        ),
        strategyOptions: fc.record(
          {
            pattern: text,
            separators: fc.array(text, { maxLength: 3 }),
            recipe: fc.constantFrom<Recipe>('plain', 'markdown', 'code'),
            strictBoundaries: fc.boolean(),
          },
          { requiredKeys: [] }
        ),
      },
      { requiredKeys: [] }
    ),
    embeddingModel: fc.constantFrom('text-embedding-3-small', 'text-embedding-3-large'),
    docs: fc
      .uniqueArray(fc.tuple(docName, fc.record({ sha256, size: fc.nat(1_000_000) })), {
        maxLength: 5,
        selector: ([name]) => name.normalize('NFC').toLowerCase(),
      })
      .map((entries) => Object.fromEntries(entries)),
  },
  { requiredKeys: ['name', 'docs'] }
)

function roundTrip(decl: KnowledgeBaseDecl) {
  const printed = knowledgeCodec.print('policies', decl)
  return knowledgeCodec.parse('policies', printed.text, printed.blobs)
}

function declaration(body: string): Record<string, string> {
  return {
    'knowledge/policies/knowledge.ts': [
      '// @sim-sdk 1',
      "import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'",
      '',
      `export default defineKnowledgeBase(${body})`,
      '',
    ].join('\n'),
  }
}

const HASH = 'a'.repeat(64)

describe('knowledgeCodec', () => {
  it('reads back every declaration it prints, byte-stable', () => {
    fc.assert(
      fc.property(knowledgeBase, (decl) => {
        const parsed = roundTrip(decl)
        expect(parsed.diagnostics).toEqual([])
        expect(parsed.decl).toEqual(decl)
        const again = parsed.decl
        if (again) {
          expect(knowledgeCodec.print('policies', again)).toEqual(
            knowledgeCodec.print('policies', decl)
          )
        }
      }),
      { numRuns: 300 }
    )
  })

  it('keeps a document named like an Object member as a document', () => {
    const parsed = knowledgeCodec.parse('policies', declaration("{ name: 'Policies' }"), [
      { path: 'knowledge/policies/docs/__proto__', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/constructor', sha256: HASH, size: 2 },
    ])
    expect(Object.keys(parsed.decl?.docs ?? {})).toEqual(['__proto__', 'constructor'])
    expect(Object.getPrototypeOf(parsed.decl?.docs)).toBe(Object.prototype)
  })

  it('fingerprints ignore spelled-out chunking defaults, the embedding model and doc order', () => {
    const a: KnowledgeBaseDecl = {
      name: 'Policies',
      docs: { 'a.md': { sha256: HASH, size: 1 }, 'b.md': { sha256: 'b'.repeat(64), size: 1 } },
    }
    const b: KnowledgeBaseDecl = {
      name: 'Policies',
      chunking: { maxSize: 1024, minSize: 100, overlap: 200, strategyOptions: {} },
      embeddingModel: 'text-embedding-3-small',
      docs: { 'b.md': { sha256: 'b'.repeat(64), size: 1 }, 'a.md': { sha256: HASH, size: 1 } },
    }
    expect(fingerprintOf(knowledgeCodec.canonical(a))).toBe(
      fingerprintOf(knowledgeCodec.canonical(b))
    )
    const edited = { ...a, docs: { ...a.docs, 'a.md': { sha256: 'c'.repeat(64), size: 1 } } }
    expect(fingerprintOf(knowledgeCodec.canonical(edited))).not.toBe(
      fingerprintOf(knowledgeCodec.canonical(a))
    )
  })

  it('pins bad chunking to its line and names the supported fields', () => {
    const parsed = knowledgeCodec.parse(
      'policies',
      declaration(
        [
          '{',
          "  name: 'Policies',",
          '  chunking: {',
          '    maxSize: -1,',
          "    strategy: 'paragraph',",
          '    overlp: 10,',
          '  },',
          '}',
        ].join('\n')
      ),
      []
    )
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.line])).toEqual([
      ['E_DECL_UNKNOWN_FIELD', 9],
      ['E_DECL_SHAPE', 7],
      ['E_DECL_SHAPE', 8],
    ])
    expect(parsed.diagnostics[0]?.hint).toContain('overlap')
  })

  it('refuses a folder without knowledge.ts', () => {
    const parsed = knowledgeCodec.parse('policies', {}, [
      { path: 'knowledge/policies/docs/a.md', sha256: HASH, size: 1 },
    ])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => finding.code)).toEqual(['E_DECL_SHAPE'])
  })

  it('refuses a document sent as text, which would otherwise read as deleted', () => {
    const parsed = knowledgeCodec.parse(
      'policies',
      { ...declaration("{ name: 'Policies' }"), 'knowledge/policies/docs/a.md': '# A\n' },
      []
    )
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.file])).toEqual([
      ['E_DECL_SHAPE', 'knowledge/policies/docs/a.md'],
    ])
  })

  it('refuses hostile document names, bad hashes and oversized documents', () => {
    const parsed = knowledgeCodec.parse('policies', declaration("{ name: 'Policies' }"), [
      { path: 'knowledge/policies/docs/.env', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/a\u0007b.md', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/a\\b.md', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/short.md', sha256: 'abc', size: 1 },
      {
        path: 'knowledge/policies/docs/huge.pdf',
        sha256: HASH,
        size: WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1,
      },
    ])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.file])).toEqual([
      ['E_KB_DOC_NAME', 'knowledge/policies/docs/.env'],
      ['E_KB_DOC_NAME', 'knowledge/policies/docs/a\u0007b.md'],
      ['E_KB_DOC_NAME', 'knowledge/policies/docs/a\\b.md'],
      ['E_LIMIT_EXCEEDED', 'knowledge/policies/docs/huge.pdf'],
      ['E_DECL_SHAPE', 'knowledge/policies/docs/short.md'],
    ])
  })

  it('still refuses when the error is past the first hundred document findings', () => {
    const suspicious = Array.from({ length: 120 }, (_, index) => ({
      path: `knowledge/policies/docs/a${index}\u200b.md`,
      sha256: 'a'.repeat(64),
      size: 1,
    }))
    const parsed = knowledgeCodec.parse('policies', declaration("{ name: 'Policies' }"), [
      ...suspicious,
      { path: 'knowledge/policies/docs/z.md', sha256: 'abc', size: 1 },
    ])

    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => finding.code)).toContain('E_DECL_SHAPE')
  })

  it('caps document findings without spending the declaration file its own findings', () => {
    const bad = Array.from({ length: 150 }, (_, index) => ({
      path: `knowledge/policies/docs/d${index}.md`,
      sha256: 'abc',
      size: 1,
    }))
    const parsed = knowledgeCodec.parse(
      'policies',
      declaration("{ name: 'Policies', overlp: 1 }"),
      bad
    )
    const counts = new Map<string, number>()
    for (const finding of parsed.diagnostics) {
      counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1)
    }
    expect(Object.fromEntries(counts)).toEqual({
      E_DECL_SHAPE: 100,
      I_FINDINGS_TRUNCATED: 1,
      E_DECL_UNKNOWN_FIELD: 1,
    })
    expect(parsed.diagnostics.at(-1)).toMatchObject({
      code: 'E_DECL_UNKNOWN_FIELD',
      span: { file: 'knowledge/policies/knowledge.ts' },
    })
  })

  it('refuses document names no disk can hold', () => {
    const long = `${'日'.repeat(100)}.md`
    const parsed = knowledgeCodec.parse('policies', declaration("{ name: 'Policies' }"), [
      { path: 'knowledge/policies/docs/CON.txt', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/notes.', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/trail ', sha256: HASH, size: 1 },
      { path: `knowledge/policies/docs/${long}`, sha256: HASH, size: 1 },
    ])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => finding.code)).toEqual([
      'E_KB_DOC_NAME',
      'E_KB_DOC_NAME',
      'E_KB_DOC_NAME',
      'E_KB_DOC_NAME',
    ])
  })

  it('refuses documents whose names differ only in letter case or normalization', () => {
    const parsed = knowledgeCodec.parse('policies', declaration("{ name: 'Policies' }"), [
      { path: 'knowledge/policies/docs/Report.pdf', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/report.pdf', sha256: HASH, size: 2 },
      { path: 'knowledge/policies/docs/caf\u00e9.md', sha256: HASH, size: 1 },
      { path: 'knowledge/policies/docs/cafe\u0301.md', sha256: HASH, size: 1 },
    ])
    expect(parsed.decl).toBeUndefined()
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.span?.file])).toEqual([
      ['E_KB_DOC_NAME', 'knowledge/policies/docs/caf\u00e9.md'],
      ['E_KB_DOC_NAME', 'knowledge/policies/docs/report.pdf'],
    ])
  })

  it('reads a name of any length, as the server stores one', () => {
    const name = 'P'.repeat(300)
    const parsed = knowledgeCodec.parse('policies', declaration(`{ name: '${name}' }`), [])
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.decl?.name).toBe(name)
  })

  it('groups by folder and refuses nested documents and stray files', () => {
    const grouped = knowledgeCodec.group([
      'knowledge/policies/knowledge.ts',
      'knowledge/policies/docs/a.md',
      'knowledge/policies/docs/nested/b.md',
      'knowledge/policies/notes.md',
      'knowledge/Bad/knowledge.ts',
      'knowledge/loose.ts',
    ])
    expect(Object.fromEntries(grouped.groups)).toEqual({
      policies: ['knowledge/policies/knowledge.ts', 'knowledge/policies/docs/a.md'],
    })
    expect(grouped.diagnostics.map((finding) => finding.code).sort()).toEqual([
      'E_DECL_UNKNOWN_FILE',
      'E_DECL_UNKNOWN_FILE',
      'E_DECL_UNKNOWN_FILE',
      'E_KEY_INVALID',
    ])
  })
})
