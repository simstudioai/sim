import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { PI_PROVIDER_CONFIGS } from '@/providers/pi-provider-configs'

const OUTPUT_PATH = new URL('../providers/pi-model-catalog.generated.ts', import.meta.url)

const catalog = Object.fromEntries(
  PI_PROVIDER_CONFIGS.map(({ id, piProviderId }) => [
    id,
    getBuiltinModels(piProviderId)
      .map(({ id: modelId }) => modelId)
      .sort(),
  ])
)

const source = `/**
 * Generated from the installed Pi model catalog by
 * \`bun run generate:pi-model-catalog\`. Do not edit manually.
 */
export const PI_MODEL_IDS_BY_PROVIDER = ${JSON.stringify(catalog, null, 2)} as const
`

const outputPath = fileURLToPath(OUTPUT_PATH)
await writeFile(outputPath, source)
execFileSync('bunx', ['biome', 'format', '--write', outputPath], { stdio: 'inherit' })
