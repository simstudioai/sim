/**
 * Materialize against the real registry and catalog, over a sample of the registry corpus: O3
 * (`canonicalize(materialize(c))` equals `c`) with every block new, which the corpus harness
 * (`corpus/roundtrip.corpus.test.ts`, with prev only) does not run, and a new block created
 * through the editing engine. O1 and O2 run over the whole corpus there.
 */

import { canonicalEquals, canonicalize, catalogBlock, materialize } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'
import { findDifferences } from '@/lib/workflows/code/corpus/proof'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { type CorpusCase, generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import { sampleCorpus } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const hooks = createMaterializeHooks()

/** Every structural case, plus the first case of each per-block kind for every block type. */
const cases = sampleCorpus(generateRegistryCorpus(), { perType: 1, byKind: true })

function canonical(state: WorkflowState, id: string) {
  return canonicalize(state, { catalog, meta: { name: id, description: null } }).workflow
}

function write(workflow: ReturnType<typeof canonical>, prev?: WorkflowState) {
  return materialize(workflow, null, { catalog, hooks, prev, lockFreshness: 'none' })
}

function failures(
  check: (corpusCase: CorpusCase) => string | null,
  subjects: CorpusCase[] = cases
): string[] {
  return subjects.flatMap((corpusCase) => {
    const failure = check(corpusCase)
    return failure === null ? [] : [`${corpusCase.id}: ${failure}`]
  })
}

describe(`materialize over the real registry (${cases.length} corpus cases)`, () => {
  it('O3: canonicalize(materialize(c)) equals c, with prev and with every block new', () => {
    expect(
      failures((corpusCase) => {
        const c = canonical(corpusCase.state, corpusCase.id)
        const withPrev = canonical(write(c, corpusCase.state).state, corpusCase.id)
        const fresh = canonical(write(c).state, corpusCase.id)
        if (!canonicalEquals(withPrev, c)) return 'differs with prev'
        if (!canonicalEquals(fresh, c)) {
          return JSON.stringify(findDifferences(c.blocks, fresh.blocks, 3))
        }
        return null
      })
    ).toEqual([])
  })

  it('creates a new block through the editing engine, with editor subBlock entries', () => {
    const c = canonical(cases[0].state, cases[0].id)
    const result = write(c)
    for (const [key, block] of Object.entries(c.blocks)) {
      const id = result.identity.blocks[key].id
      const stored = result.state.blocks[id]
      expect(stored.type).toBe(block.type)
      const declared = catalogBlock(catalog, block.type)?.subBlocks.map((s) => s.id) ?? []
      for (const subBlockId of declared) expect(stored.subBlocks).toHaveProperty(subBlockId)
    }
  })
})
