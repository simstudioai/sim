/**
 * Field checks against the REAL block catalog, on hosted Sim (where hosted models need no API
 * key): the five SDK example workflows compile with no diagnostics at all, and across the
 * registry corpus `W_REQUIRED_MISSING` never names a field the editor itself hides under the
 * block's stored values. The oracle is the registry's own condition, evaluated on the stored
 * values, never the catalog's projection of it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')

import { canonicalize, catalogBlock, compileWorkflow, printWorkflow } from '@sim/workflow-code'
import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { paramAliases } from '@sim/workflow-code/catalog/surface'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import { corpusBudgetMs, sampleCorpus } from '@/lib/workflows/code/corpus/fixtures.test-helpers'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { getBlock, getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

setEnvFlags({ isHosted: true })
afterAll(resetEnvFlagsMock)

/** Built after the hosted flag is set, which decides whether hosted models require an API key. */
const catalog = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

const EXAMPLES_DIR = path.resolve(process.cwd(), '../../packages/workflow-sdk/test/examples')
/** The code file `lead-enrichment.ts` references. */
const EXAMPLE_CODE_FILES = new Map([['functions/score.js', 'return { score: 1 }\n']])
const CASES_PER_BLOCK_TYPE = 2

/** Field types whose values decide other fields' visibility; every other value is emptied. */
const DRIVER_TYPES = new Set(['dropdown', 'combobox', 'switch', 'checkbox'])

/**
 * The case with every non-driver field emptied, so required fields go missing while the values
 * that decide visibility (operation, model, destination switches) stay as stored.
 */
function withoutFreeText(state: WorkflowState): WorkflowState {
  const blocks: WorkflowState['blocks'] = {}
  for (const [id, block] of Object.entries(state.blocks)) {
    const subBlocks: typeof block.subBlocks = {}
    for (const [key, sub] of Object.entries(block.subBlocks ?? {})) {
      subBlocks[key] = DRIVER_TYPES.has(sub.type) ? sub : { ...sub, value: null }
    }
    blocks[id] = { ...block, subBlocks }
  }
  return { ...state, blocks }
}

describe('catalog field checks on the SDK examples and the registry corpus', () => {
  it.each(readdirSync(EXAMPLES_DIR).filter((name) => name.endsWith('.ts')))(
    '%s compiles with no diagnostics',
    (name) => {
      const result = compileWorkflow({
        entry: { path: 'workflow.ts', text: readFileSync(path.join(EXAMPLES_DIR, name), 'utf8') },
        files: EXAMPLE_CODE_FILES,
        catalog,
        sdkMajor: catalog.sdkMajor,
      })
      expect(
        result.diagnostics.map(
          (diagnostic) =>
            `${diagnostic.code} ${diagnostic.blockKey ?? ''}.${diagnostic.param ?? ''}: ${diagnostic.message}`
        )
      ).toEqual([])
    }
  )

  const sampled = sampleCorpus(generateRegistryCorpus(), { perType: CASES_PER_BLOCK_TYPE }).filter(
    (corpusCase) => !corpusCase.unknownTypes
  )

  /**
   * A corpus pass, so it takes the corpus budget like its siblings: 5.3 s alone, 16.5 s beside the
   * other workflow-code suites, against Vitest's 10 s default.
   */
  it(
    'never reports a required field the editor hides under the stored values, even with every free-text field empty',
    () => {
      const violations: string[] = []
      let reported = 0
      for (const corpusCase of sampled) {
        const state = withoutFreeText(corpusCase.state)
        const meta = { name: corpusCase.id, description: null }
        const canonical = canonicalize(state, { catalog, meta })
        const [entry] = printWorkflow({
          workflow: canonical.workflow,
          catalog,
          options: { functionCode: 'inline' },
        }).files
        const compiled = compileWorkflow({
          entry: { path: entry.path, text: entry.text },
          files: new Map(),
          catalog,
          sdkMajor: catalog.sdkMajor,
          stored: canonical.workflow,
        })
        for (const diagnostic of compiled.diagnostics) {
          if (diagnostic.code !== 'W_REQUIRED_MISSING' || !diagnostic.blockKey) continue
          reported += 1
          const blockId = canonical.identity.blocks[diagnostic.blockKey]?.id
          const block = blockId ? state.blocks[blockId] : undefined
          const config = block ? getBlock(block.type) : undefined
          if (!block || !config) continue
          const values = buildSubBlockValues(block.subBlocks ?? {})
          const declared = catalogBlock(catalog, block.type)
          const aliased = declared ? paramAliases(declared, block.triggerMode === true) : new Map()
          const param =
            [...aliased].find(([, alias]) => alias === diagnostic.param)?.[0] ?? diagnostic.param
          const members = config.subBlocks.filter(
            (sub) => sub.id === param || sub.canonicalParamId === param
          )
          if (!members.some((sub) => evaluateSubBlockCondition(sub.condition, values))) {
            violations.push(`${corpusCase.id} ${diagnostic.blockKey}.${diagnostic.param}`)
          }
        }
      }
      expect(reported).toBeGreaterThan(0)
      expect(violations).toEqual([])
    },
    corpusBudgetMs(sampled.length)
  )
})
