/**
 * Materialize against the real registry, catalog and serializer (s1 §6):
 * - O1: `materialize(canonicalize(x), null, { prev: x })` deep-equals `x` for a sample of the
 *   registry corpus covering every corpus kind (all s1 §5 quirk classes the generator emits);
 * - O3: `canonicalize(materialize(c))` equals `c`, with prev and with every block new;
 * - O2: materialized lockless with no prev, then aligned to the original by key, the serializer
 *   sees the same params, tools, connections and subflows, and `hasWorkflowChanged` is false.
 *   Cases whose types the registry does not know are skipped: the serializer rejects the original.
 *
 * The whole corpus runs in `corpus/roundtrip.corpus.test.ts`; this file keeps a fast sample so a
 * hook or materialize regression fails here first.
 */

import { canonicalEquals, canonicalize, catalogBlock, materialize } from '@sim/workflow-code'
import { executionParity, findDifferences } from '@sim/workflow-code/proof'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { type CorpusCase, generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import { withoutLockHeldState } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { hasWorkflowChanged } from '@/lib/workflows/comparison/compare'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const { catalog } = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})
const hooks = createMaterializeHooks()
const serializer = new Serializer()

/** Every structural case, plus the first case of each per-block kind for every block type. */
function sample(corpus: CorpusCase[]): CorpusCase[] {
  const seen = new Set<string>()
  return corpus.filter((corpusCase) => {
    if (!['operation', 'trigger', 'standalone-advanced', 'error-edge'].includes(corpusCase.kind)) {
      return true
    }
    const [, type = ''] = corpusCase.id.split(':')
    const slot = `${corpusCase.kind}:${type}`
    if (seen.has(slot)) return false
    seen.add(slot)
    return true
  })
}

const cases = sample(generateRegistryCorpus())

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
  it('covers every corpus kind', () => {
    expect(new Set(cases.map((c) => c.kind))).toEqual(
      new Set([
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
      ])
    )
  })

  it('O1: a no-op round trip writes the stored state back exactly', () => {
    expect(
      failures((corpusCase) => {
        const result = write(canonical(corpusCase.state, corpusCase.id), corpusCase.state)
        const differences = findDifferences(corpusCase.state, result.state, 3)
        return differences.length === 0 ? null : JSON.stringify(differences)
      })
    ).toEqual([])
  })

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

  it('O2: a lockless write with no prev executes like the original', () => {
    const executable = cases.filter((corpusCase) => !corpusCase.unknownTypes)
    expect(executable.length).toBeGreaterThan(cases.length / 2)
    expect(
      failures((corpusCase) => {
        const result = executionParity({
          original: withoutLockHeldState(corpusCase.state, catalog),
          candidate: withoutLockHeldState(
            write(canonical(corpusCase.state, corpusCase.id)).state,
            catalog
          ),
          serialize: (state) =>
            serializer.serializeWorkflow(state.blocks, state.edges, state.loops, state.parallels),
          hasWorkflowChanged,
        })
        return result.ok ? null : JSON.stringify(result.differences.slice(0, 5))
      }, executable)
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
