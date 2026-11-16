/**
 * The real-catalog snapshot `@sim/workflow-code`'s printer goldens run against
 * (`packages/workflow-code/src/print/__fixtures__/real-catalog.json`). The package cannot import
 * the registry, so the slice of `buildBlockCatalog` its golden cases use is checked in, and this
 * drift check rebuilds it from the live registry: a registry change that alters what the goldens
 * print fails here first. Regenerate with `WORKFLOW_CODE_GOLDEN_CATALOG_UPDATE=1`, then refresh the
 * goldens (`bun run --cwd packages/workflow-code test src/print src/compile -u`).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  type BlockCatalog,
  type CatalogBlock,
  type CatalogBuilder,
  type CatalogTrigger,
  catalogBlock,
  catalogBuilder,
  catalogBuilderPaths,
  catalogTrigger,
  compactBlockCatalog,
  sha256Hex,
  stableStringify,
} from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/registry')

import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

const SNAPSHOT = path.resolve(
  process.cwd(),
  '../../packages/workflow-code/src/print/__fixtures__/real-catalog.json'
)

/** Every registry block type a printer golden case uses. */
const GOLDEN_CATALOG_TYPES = [
  'agent',
  'api',
  'condition',
  'function',
  'generic_webhook',
  'gmail_v2',
  'note',
  'response',
  'router_v2',
  'slack_v2',
  'start_trigger',
  'table_v2',
  'variables',
]

/**
 * The catalog narrowed to the golden types: their blocks, the builders that create them, and the
 * triggers they deploy as (a trigger block is its own trigger), compacted like the served core
 * shard and hashed the same way.
 */
function goldenCatalog(catalog: BlockCatalog): BlockCatalog {
  const blocks: Record<string, CatalogBlock> = {}
  for (const type of GOLDEN_CATALOG_TYPES) {
    const block = catalogBlock(catalog, type)
    if (!block) throw new Error(`${type} is not in the registry catalog`)
    blocks[type] = block
  }
  const triggers: Record<string, CatalogTrigger> = {}
  const triggerIds = Object.values(blocks).flatMap((block) => [
    block.type,
    ...(block.triggers?.available ?? []),
  ])
  for (const id of triggerIds) {
    const trigger = catalogTrigger(catalog, id)
    if (trigger) triggers[id] = trigger
  }
  const builders: Record<string, CatalogBuilder> = {}
  for (const builderPath of catalogBuilderPaths(catalog)) {
    const builder = catalogBuilder(catalog, builderPath)
    if (builder && Object.hasOwn(blocks, builder.type)) builders[builderPath] = builder
  }
  const { core } = compactBlockCatalog({
    catalogVersion: catalog.catalogVersion,
    sdkMajor: catalog.sdkMajor,
    blocks,
    triggers,
    builders,
  })
  return { ...core, hash: sha256Hex(stableStringify(core)) }
}

describe('the printer goldens real-catalog snapshot', () => {
  it('matches the live registry', () => {
    const { catalog } = buildBlockCatalog({
      blocks: Object.values(getBlockRegistry()),
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
    })
    const text = `${JSON.stringify(goldenCatalog(catalog))}\n`
    if (process.env.WORKFLOW_CODE_GOLDEN_CATALOG_UPDATE === '1') writeFileSync(SNAPSHOT, text)
    expect(
      readFileSync(SNAPSHOT, 'utf8') === text,
      'real-catalog.json is stale: rerun with WORKFLOW_CODE_GOLDEN_CATALOG_UPDATE=1'
    ).toBe(true)
  })
})
