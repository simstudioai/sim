/**
 * The corpus is only proof if its fixtures are states the product could have stored. These
 * properties hold over the whole real registry: every block type yields a fixture, every fixture
 * passes the existing workflow and per-value validators, free text carries the adversarial
 * payload, and the corpus is a pure function of the seed.
 */
import { compareStrings } from '@sim/utils/string'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import {
  CORPUS_CRLF_TEXT,
  CORPUS_TEXT,
  CORPUS_TEXT_MARKERS,
  type CorpusCase,
  generateRegistryCorpus,
} from '@/lib/workflows/code/corpus'
import {
  validateSourceHandleForBlock,
  validateValueForSubBlockType,
} from '@/lib/workflows/editing/validation'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { getBlockRegistry } from '@/blocks/registry'

const corpus = generateRegistryCorpus()
const known = corpus.filter((c) => !c.unknownTypes)

function valueProblems(corpusCase: CorpusCase): string[] {
  const problems: string[] = []
  for (const block of Object.values(corpusCase.state.blocks)) {
    const config = getBlockRegistry()[block.type]
    if (!config) continue
    for (const [id, subBlock] of Object.entries(block.subBlocks)) {
      if (subBlock.value === null) continue
      const declarations = config.subBlocks.filter((s) => s.id === id)
      if (declarations.length === 0) {
        problems.push(`${block.type}.${id}: not declared`)
        continue
      }
      const results = declarations.map((declared) =>
        validateValueForSubBlockType(declared, subBlock.value, id, block.type, block.id)
      )
      const legacyText =
        corpusCase.storedQuirk === 'legacy-scalar-text' &&
        typeof subBlock.value === 'string' &&
        declarations.some((declared) => declared.type === 'switch' || declared.type === 'slider')
      if (!legacyText && !results.some((result) => result.valid)) {
        problems.push(`${block.type}.${id}: ${results[0]?.error?.error}`)
      }
    }
  }
  for (const edge of corpusCase.state.edges) {
    const source = corpusCase.state.blocks[edge.source]
    if (!source) continue
    const implicitHandle = edge.sourceHandle === `condition-${source.id}-if`
    if (corpusCase.storedQuirk === 'implicit-branch-handle' && implicitHandle) continue
    const result = validateSourceHandleForBlock(edge.sourceHandle ?? 'source', source.type, source)
    if (!result.valid) problems.push(`edge ${edge.sourceHandle}: ${result.error}`)
  }
  return problems
}

describe('generateRegistryCorpus', () => {
  it('yields at least one fixture for every registered block type', () => {
    const covered = new Set(corpus.flatMap((c) => c.blockTypes))
    const missing = Object.keys(getBlockRegistry()).filter((type) => !covered.has(type))
    expect(missing).toEqual([])
  })

  it('gives every case a unique id', () => {
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length)
  })

  it('passes validateWorkflowState for every known-type fixture', () => {
    const failures = known.flatMap((c) => {
      const result = validateWorkflowState(c.state)
      return result.valid ? [] : [`${c.id}: ${result.errors.join('; ')}`]
    })
    expect(failures).toEqual([])
  })

  it('rejects only the unknown types in unknown-type fixtures', () => {
    const unknown = corpus.filter((c) => c.unknownTypes)
    expect(unknown.length).toBeGreaterThan(0)
    for (const c of unknown) {
      const { errors } = validateWorkflowState(c.state)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.every((e) => e.includes('unknown block type'))).toBe(true)
    }
  })

  it('stores only values the editor validators accept, on handles they accept', () => {
    const failures = known.flatMap((c) => valueProblems(c).map((p) => `${c.id}: ${p}`))
    expect(failures.slice(0, 20)).toEqual([])
  })

  it('carries every payload marker in each free-text value', () => {
    const texts = known.flatMap((c) =>
      Object.values(c.state.blocks).flatMap((block) => {
        const config = getBlockRegistry()[block.type]
        return Object.values(block.subBlocks).flatMap((s) => {
          if (s.type !== 'short-input' && s.type !== 'long-input') return []
          if (typeof s.value !== 'string') return []
          const declarations = config?.subBlocks.filter((declared) => declared.id === s.id) ?? []
          const freeText = declarations.every(
            (declared) => declared.type === 'short-input' || declared.type === 'long-input'
          )
          const isDeclaredDefault = declarations.some(
            (declared) => declared.defaultValue === s.value
          )
          return freeText && !isDeclaredDefault ? [s.value] : []
        })
      })
    )
    expect(texts.length).toBeGreaterThan(1000)
    for (const text of new Set(texts)) {
      for (const marker of CORPUS_TEXT_MARKERS) expect(text).toContain(marker)
    }
    expect(texts.every((t) => t === CORPUS_TEXT || t === CORPUS_CRLF_TEXT)).toBe(true)
  })

  it('covers every pairwise dimension the proof needs', () => {
    const kinds = new Set(corpus.map((c) => c.kind))
    for (const kind of [
      'operation',
      'trigger',
      'standalone-advanced',
      'error-edge',
      'branches',
      'name-collision',
      'subflow',
      'input-format',
      'variables',
      'unknown-type',
      'shape',
      'unicode-names',
      'crlf-text',
      'agent-tools',
    ]) {
      expect(kinds).toContain(kind)
    }
    expect(corpus.some((c) => c.id.endsWith(':advanced'))).toBe(true)
    expect(corpus.some((c) => c.id === 'branches:condition:null-rows')).toBe(true)
    const toolLists = known
      .filter((c) => c.kind !== 'agent-tools')
      .flatMap((c) =>
        Object.values(c.state.blocks).flatMap((b) => {
          const tools = b.subBlocks.tools?.value
          return b.subBlocks.tools?.type === 'tool-input' && Array.isArray(tools) ? [tools] : []
        })
      )
    expect(toolLists.length).toBeGreaterThan(0)
    for (const tools of toolLists) {
      const types = tools.map((t) => (t as { type?: string }).type)
      expect(types.length).toBe(2)
      expect(types[0]).toBe(types[1])
    }
  })

  it('is a pure function of the seed', () => {
    // Purity is the seeded generator's, not any block's: a fixed slice of the registry proves it
    // at a fraction of the cost of two more full-registry generations.
    const blocks = Object.values(getBlockRegistry())
      .sort((a, b) => compareStrings(a.type, b.type))
      .slice(0, 40)
    const sample = generateRegistryCorpus({ blocks })
    expect(generateRegistryCorpus({ blocks })).toEqual(sample)
    const reseeded = generateRegistryCorpus({ blocks, seed: 1 })
    expect(reseeded.map((c) => c.id)).toEqual(sample.map((c) => c.id))
    expect(reseeded).not.toEqual(sample)
  })
})
