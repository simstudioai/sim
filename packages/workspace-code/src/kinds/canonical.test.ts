/**
 * Every declared field reaches the fingerprint. A field a kind forgets in `canonical` fingerprints
 * an edit to it equal to the base, so the three-way rule reads the edit as a no-op and drops it
 * without a finding. Each kind lists a changed value for every field of its declaration (typed over
 * the declaration, so a new field fails to compile here until it has one), and changing any one
 * field alone must change the fingerprint.
 */
import { describe, expect, it } from 'vitest'
import { fingerprintOf } from '../fingerprint'
import type { KindCodec } from '../kind'
import { type FileDecl, fileCodec } from './files'
import { type KnowledgeBaseDecl, type KnowledgeChunkingDecl, knowledgeCodec } from './knowledge'
import { type McpServerDecl, mcpCodec } from './mcp'
import { type SkillDecl, skillCodec } from './skills'
import type { TableColumnDecl, TableDecl } from './table'
import { testTableCodec } from './table.test-helpers'
import { type ToolDecl, toolCodec } from './tools'

/** A changed value for every field of `D`. */
type Changes<D> = { readonly [K in keyof D]-?: Exclude<D[K], undefined> }

/**
 * The fields of `base` whose change alone leaves `fingerprint` as it was, apart from `outside`
 * (fields deliberately left out of the fingerprint), which must leave it unchanged.
 */
function unfingerprinted<D extends object>(
  fingerprint: (decl: D) => string,
  base: D,
  changes: Changes<D>,
  outside: readonly (keyof D)[] = []
): string[] {
  const before = fingerprint(base)
  const wrong: string[] = []
  for (const field in changes) {
    const changed = fingerprint({ ...base, [field]: changes[field] })
    if ((changed === before) !== outside.includes(field)) wrong.push(field)
  }
  return wrong
}

function fingerprintBy<D>(codec: KindCodec<D>): (decl: D) => string {
  return (decl) => fingerprintOf(codec.canonical(decl))
}

const SHA = 'a'.repeat(64)

describe('every declared field reaches the fingerprint', () => {
  it('knowledge base', () => {
    const chunking: KnowledgeChunkingDecl = {
      maxSize: 512,
      minSize: 50,
      overlap: 20,
      strategy: 'recursive',
      strategyOptions: {
        pattern: 'a',
        separators: ['\n'],
        recipe: 'plain',
        strictBoundaries: false,
      },
    }
    const base: KnowledgeBaseDecl = {
      name: 'Policies',
      description: 'Support',
      folder: '/support',
      chunking,
      embeddingModel: 'text-embedding-3-small',
      docs: { 'a.md': { sha256: SHA, size: 1 } },
    }
    const options = chunking.strategyOptions ?? {}
    const fingerprint = fingerprintBy(knowledgeCodec)

    expect(
      unfingerprinted(
        fingerprint,
        base,
        {
          name: 'Rules',
          description: 'Sales',
          folder: '/sales',
          chunking: { ...chunking, maxSize: 256 },
          embeddingModel: 'text-embedding-3-large',
          docs: { 'a.md': { sha256: 'b'.repeat(64), size: 1 } },
        },
        ['embeddingModel']
      )
    ).toEqual([])
    expect(
      unfingerprinted((value) => fingerprint({ ...base, chunking: value }), chunking, {
        maxSize: 2048,
        minSize: 10,
        overlap: 0,
        strategy: 'token',
        strategyOptions: { ...options, recipe: 'code' },
      })
    ).toEqual([])
    expect(
      unfingerprinted(
        (value) => fingerprint({ ...base, chunking: { ...chunking, strategyOptions: value } }),
        options,
        { pattern: 'b', separators: ['\n\n'], recipe: 'markdown', strictBoundaries: true }
      )
    ).toEqual([])
  })

  it('table', () => {
    const column: TableColumnDecl = {
      type: 'select',
      name: 'status',
      required: false,
      unique: false,
      options: ['new'],
      multiple: false,
      currencyCode: 'USD',
    }
    const base: TableDecl = {
      name: 'leads',
      description: 'Inbound',
      folder: '/sales',
      columns: { stage: column },
    }
    const fingerprint = fingerprintBy(testTableCodec)

    expect(
      unfingerprinted(fingerprint, base, {
        name: 'deals',
        description: 'Closed',
        folder: '/ops',
        columns: { stage: { ...column, required: true } },
      })
    ).toEqual([])
    expect(
      unfingerprinted(
        (value) => fingerprint({ ...base, columns: { stage: value } }),
        column,
        {
          type: 'string',
          name: 'state',
          required: true,
          unique: true,
          options: ['new', 'won'],
          multiple: true,
          currencyCode: 'EUR',
        },
        // A select column owns neither: the server stores no currency on it.
        ['currencyCode']
      )
    ).toEqual([])
  })

  it('custom tool', () => {
    const base: ToolDecl = { title: 'Lookup', schema: { type: 'function' }, code: 'return 1' }

    expect(
      unfingerprinted(fingerprintBy(toolCodec), base, {
        title: 'Find',
        schema: { type: 'function', function: { name: 'find' } },
        code: 'return 2',
      })
    ).toEqual([])
  })

  it('MCP server', () => {
    const base: McpServerDecl = {
      name: 'GitHub',
      description: 'Issues',
      url: 'https://mcp.example.com',
      transport: 'streamable-http',
      headers: { Authorization: { stored: 'a' } },
      auth: { type: 'oauth', clientId: 'one' },
      timeout: 1000,
      retries: 1,
      enabled: true,
    }

    expect(
      unfingerprinted(
        fingerprintBy(mcpCodec),
        base,
        {
          name: 'Hub',
          description: 'Pulls',
          url: 'https://mcp.example.org',
          // The only transport there is; its default fingerprints alike.
          transport: 'streamable-http',
          headers: { Authorization: { stored: 'b' } },
          auth: { type: 'oauth', clientId: 'two' },
          timeout: 2000,
          retries: 2,
          enabled: false,
        },
        ['transport']
      )
    ).toEqual([])
  })

  it('skill', () => {
    const base: SkillDecl = { name: 'tone', description: 'Voice', content: 'Be brief.' }

    expect(
      unfingerprinted(fingerprintBy(skillCodec), base, {
        name: 'voice',
        description: 'Tone',
        content: 'Be warm.',
      })
    ).toEqual([])
  })

  it('file', () => {
    const base: FileDecl = { sha256: SHA, size: 1 }

    expect(
      unfingerprinted(fingerprintBy(fileCodec), base, { sha256: 'b'.repeat(64), size: 1 }, ['size'])
    ).toEqual([])
  })
})
