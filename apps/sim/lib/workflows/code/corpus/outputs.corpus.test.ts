/**
 * Stored outputs are server-owned and derived (s1 D6). A source edit must change exactly the field
 * it edits: when the edited param is not one the outputs derive from, the stored outputs stay as
 * they are, even when they differ from what the registry would compute today (older blocks, or the
 * `outputs: {}` an API-built block can hold). The canvas never rewrites them on such an edit.
 *
 * Over every corpus workflow, with every block's stored outputs seeded stale (`{}`), this edits one
 * active text param per block, one whose change leaves the derived outputs unchanged, and asserts
 * the materialized block equals the stored one but for that subBlock's value.
 */
import { compareStrings } from '@sim/utils/string'
import {
  type CanonicalWorkflow,
  canonicalize,
  executableInactiveParams,
  materialize,
} from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { roundTripSubjects } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const CASES_PER_BLOCK_TYPE = 3
const FUZZ_RUNS = 50
const BUDGET_MS = 60_000
const EDIT_SUFFIX = ' (edited)'

const hooks = createMaterializeHooks()
const { catalog } = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

const subjects = roundTripSubjects({
  casesPerBlockType: CASES_PER_BLOCK_TYPE,
  full: process.env.ROUNDTRIP_CORPUS_FULL === '1',
  fuzzRuns: FUZZ_RUNS,
  extraDir: process.env.ROUNDTRIP_CORPUS_EXTRA_DIR,
})

function withStaleOutputs(state: WorkflowState): WorkflowState {
  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(state.blocks)) blocks[id] = { ...block, outputs: {} }
  return { ...state, blocks }
}

function withSubBlockValue(block: BlockState, id: string, value: string): BlockState {
  return {
    ...block,
    subBlocks: { ...block.subBlocks, [id]: { ...block.subBlocks[id], value } },
  }
}

/**
 * The first active, stored text param of a block whose edit leaves the derived outputs unchanged,
 * with the stored block as that edit would leave it.
 */
function editableParam(
  workflow: CanonicalWorkflow,
  key: string,
  stored: BlockState
): { param: string; value: string; expected: BlockState } | null {
  const block = workflow.blocks[key]
  if (block.subflow || block.branches) return null
  const inactive = new Set(executableInactiveParams(block, catalog))
  for (const param of Object.keys(block.params).sort(compareStrings)) {
    const canonical = block.params[param]
    const raw = stored.subBlocks[param]?.value
    if (inactive.has(param) || param === 'operation') continue
    if (canonical.kind !== 'value' || typeof canonical.value !== 'string') continue
    if (typeof raw !== 'string' || raw !== canonical.value || raw.includes('<')) continue
    const value = `${raw}${EDIT_SUFFIX}`
    const expected = withSubBlockValue(stored, param, value)
    const derivedBefore = JSON.stringify(hooks.computeOutputs(stored))
    if (JSON.stringify(hooks.computeOutputs(expected)) !== derivedBefore) continue
    return { param, value, expected }
  }
  return null
}

describe(`stored outputs survive edits they do not derive from (${subjects.length} workflows)`, () => {
  it(
    'a one-field edit changes exactly that stored field',
    () => {
      const drift: string[] = []
      let edited = 0
      for (const subject of subjects) {
        if (subject.unknownTypes) continue
        const stale = withStaleOutputs(subject.state)
        const { workflow, identity } = canonicalize(stale, {
          catalog,
          meta: { name: subject.id, description: null },
        })
        const target: CanonicalWorkflow = structuredClone(workflow)
        const expected = new Map<string, BlockState>()
        for (const key of Object.keys(workflow.blocks)) {
          const id = identity.blocks[key].id
          const edit = editableParam(workflow, key, stale.blocks[id])
          if (!edit) continue
          target.blocks[key].params[edit.param] = { kind: 'value', value: edit.value }
          expected.set(id, edit.expected)
        }
        if (expected.size === 0) continue
        let state: WorkflowState
        try {
          state = materialize(target, null, {
            catalog,
            hooks,
            prev: stale,
            lockFreshness: 'none',
          }).state
        } catch (error) {
          drift.push(`${subject.id}: ${String(error)}`)
          continue
        }
        for (const [id, block] of Object.entries(stale.blocks)) {
          edited += expected.has(id) ? 1 : 0
          const want = expected.get(id) ?? block
          if (JSON.stringify(state.blocks[id]) !== JSON.stringify(want)) {
            drift.push(`${subject.id} ${block.type} ${id}`)
          }
        }
      }
      expect(edited).toBeGreaterThan(0)
      expect(drift).toEqual([])
    },
    BUDGET_MS
  )
})
