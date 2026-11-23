#!/usr/bin/env bun
/**
 * Maintains `packages/workflow-sdk/test/fixtures/catalog.json`, the block catalog the SDK and CLI
 * tests compile against.
 *
 * The fixture is not hand-written: it is the real `projectBlockCatalog` projection of a subset of
 * registry blocks, so a test over it exercises the shapes production emits. The subset is the set
 * of block types already in the fixture; add a block by adding its type key to `blocks` and
 * regenerating. The hash is pinned to `'fixture'` so the file changes only when a projected block
 * does.
 *
 * Any change to a projected block, its tools' outputs, its SDK names, or a model list it reads
 * drifts this file, which is why `--check` runs in `check:audits` instead of leaving the drift for
 * a test shard to find.
 *
 * Usage:
 *   bun run apps/sim/scripts/generate-sdk-fixture-catalog.ts           # rewrite the fixture
 *   bun run apps/sim/scripts/generate-sdk-fixture-catalog.ts --check   # fail if it is stale
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(
  SCRIPT_DIR,
  '../../../packages/workflow-sdk/test/fixtures/catalog.json'
)
const FIXTURE_LABEL = 'packages/workflow-sdk/test/fixtures/catalog.json'

const checkOnly = process.argv.includes('--check')
const current = await readFile(FIXTURE_PATH, 'utf8')
const types = new Set(Object.keys((JSON.parse(current) as { blocks: object }).blocks))

const blocks = Object.values(getBlockRegistry()).filter((block) => types.has(block.type))
const projected = {
  ...projectBlockCatalog({ blocks, trigger: registryTrigger, sdkNames: SDK_NAMES }),
  hash: 'fixture',
}
const text = `${JSON.stringify(projected, null, 2)}\n`

if (checkOnly) {
  if (current !== text) {
    console.error(
      `${FIXTURE_LABEL} is stale: it no longer matches the registry projection of its ${types.size} blocks. Run \`bun run generate:sdk-fixture-catalog\` and commit the result.`
    )
    process.exit(1)
  }
  console.log(`${FIXTURE_LABEL} matches the registry projection of its ${types.size} blocks.`)
} else if (current === text) {
  console.log(`${FIXTURE_LABEL} is already up to date (${types.size} blocks).`)
} else {
  await writeFile(FIXTURE_PATH, text)
  console.log(`Regenerated ${FIXTURE_LABEL} (${types.size} blocks).`)
}
