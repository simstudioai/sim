/**
 * Defaults rule (DESIGN.md "Defaults"): a param omitted in source means the editor default, so a block written
 * from code with no params is stored exactly as canvas creation stores it, and the two execute the
 * same. For every registry block type, in action mode and (where it can host one) trigger mode,
 * this compares the block `MaterializeHooks.initBlock` creates with the block materialize writes
 * for `block(type, name, {})`.
 *
 * Two values differ by design and are left out of the equality:
 * - a field whose `value()` thunk mints a fresh value per call (a webhook token): two canvas
 *   creations differ too, and source cannot name the value it will get. The block written from
 *   code must still get a minted value wherever canvas creation mints one (a code-created generic
 *   webhook needs its auth token), of the same type;
 * - condition and router rows: canvas creation mints placeholder rows with fresh ids, while source
 *   `{}` is the never-persisted `rows: null` form, which canvas reads the
 *   same way until the first edit.
 */
import { catalogBlock, catalogBlockTypes, compileWorkflow, materialize } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')
vi.unmock('@/tools/registry')

import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { getBlockRegistry } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

const hooks = createMaterializeHooks()
const registry = getBlockRegistry()

const NAME = 'Parity'

function sourceFor(type: string, triggerMode: boolean): string {
  const meta = triggerMode ? ', { triggerMode: true }' : ''
  return [
    `// @sim-sdk ${catalog.sdkMajor}`,
    "import { block, workflow } from '@sim/workflow-sdk'",
    '',
    "export default workflow('Parity', {}, () => {",
    `  block(${JSON.stringify(type)}, '${NAME}', {}${meta})`,
    '})',
    '',
  ].join('\n')
}

/**
 * Ids whose creation value is minted per call (two canvas creations disagree on it), and the
 * branch list of a condition or router.
 */
function excludedIds(type: string, created: BlockState, again: BlockState): Set<string> {
  const excluded = new Set<string>()
  for (const [id, subBlock] of Object.entries(created.subBlocks)) {
    if (JSON.stringify(subBlock?.value) !== JSON.stringify(again.subBlocks[id]?.value)) {
      excluded.add(id)
    }
  }
  const branches = catalogBlock(catalog, type)?.graph.branches?.subBlockId
  if (branches) excluded.add(branches)
  return excluded
}

/** The stored state that decides what a block runs, with absent and `null` read alike. */
function stored(block: BlockState, excluded: Set<string>) {
  const values: Record<string, unknown> = {}
  for (const [id, subBlock] of Object.entries(block.subBlocks)) {
    if (excluded.has(id)) continue
    if (subBlock?.value !== null && subBlock?.value !== undefined) values[id] = subBlock.value
  }
  return {
    values,
    canonicalModes: block.data?.canonicalModes ?? {},
    triggerMode: block.triggerMode === true,
    advancedMode: block.advancedMode === true,
    enabled: block.enabled !== false,
  }
}

function canHostTrigger(type: string): boolean {
  const config = registry[type]
  return config?.category !== 'triggers' && config?.triggers?.enabled === true
}

const cases = catalogBlockTypes(catalog)
  .filter((type) => Object.hasOwn(registry, type))
  .flatMap((type) => [
    { type, triggerMode: false },
    ...(canHostTrigger(type) ? [{ type, triggerMode: true }] : []),
  ])

describe(`a code-created block matches a canvas-created one (${cases.length} cases)`, () => {
  it('stores the same values, modes and flags for every block type with no params', () => {
    const mismatches: string[] = []
    for (const { type, triggerMode } of cases) {
      const label = `${type}${triggerMode ? ' (trigger mode)' : ''}`
      const compiled = compileWorkflow({
        entry: { path: 'workflow.ts', text: sourceFor(type, triggerMode) },
        files: new Map(),
        catalog,
        sdkMajor: catalog.sdkMajor,
      })
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error')
      if (!compiled.workflow || errors.length > 0) {
        mismatches.push(`${label}: compile ${errors.map((d) => d.code).join(', ')}`)
        continue
      }
      const written = Object.values(
        materialize(compiled.workflow, null, { catalog, hooks, lockFreshness: 'none' }).state.blocks
      )[0]
      const created = hooks.initBlock({ id: written.id, type, name: NAME, triggerMode })
      const again = hooks.initBlock({ id: written.id, type, name: NAME, triggerMode })
      const excluded = excludedIds(type, created, again)
      for (const id of excluded) {
        if (id === catalogBlock(catalog, type)?.graph.branches?.subBlockId) continue
        const minted = created.subBlocks[id]?.value
        const fromSource = written.subBlocks[id]?.value
        const present = (value: unknown) => value !== null && value !== undefined
        if (present(minted) !== present(fromSource) || typeof minted !== typeof fromSource) {
          mismatches.push(
            `${label}: ${id} minted ${typeof minted}, from source ${typeof fromSource}`
          )
        }
      }
      const fromCode = stored(written, excluded)
      const fromCanvas = stored(created, excluded)
      if (JSON.stringify(fromCode) !== JSON.stringify(fromCanvas)) {
        const ids = [
          ...new Set([...Object.keys(fromCode.values), ...Object.keys(fromCanvas.values)]),
        ].filter(
          (id) => JSON.stringify(fromCode.values[id]) !== JSON.stringify(fromCanvas.values[id])
        )
        const modes =
          JSON.stringify(fromCode.canonicalModes) === JSON.stringify(fromCanvas.canonicalModes)
            ? ''
            : ` modes ${JSON.stringify(fromCode.canonicalModes)} vs ${JSON.stringify(fromCanvas.canonicalModes)}`
        mismatches.push(`${label}: ${ids.join(', ')}${modes}`)
      }
    }
    expect(cases.length).toBeGreaterThan(400)
    expect(mismatches).toEqual([])
  }, 120_000)
})
