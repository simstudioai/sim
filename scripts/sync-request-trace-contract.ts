import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/request-trace-v1.schema.json'
)
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/request-trace-v1.ts')

function generateRuntimeConstants(schema: Record<string, unknown>): string {
  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<string, unknown>
  const lines: string[] = []

  for (const [name, def] of Object.entries(defs)) {
    if (!def || typeof def !== 'object') continue
    const defObj = def as Record<string, unknown>
    const enumValues = defObj.enum
    if (!Array.isArray(enumValues) || enumValues.length === 0) continue
    if (!enumValues.every((v) => typeof v === 'string')) continue

    const entries = (enumValues as string[])
      .map((v) => `  ${JSON.stringify(v)}: ${JSON.stringify(v)}`)
      .join(',\n')

    lines.push(
      `export const ${name} = {\n${entries},\n} as const;\n`
    )
  }

  return lines.join('\n')
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputPathArg = process.argv.find((arg) => arg.startsWith('--input='))
  const inputPath = inputPathArg ? resolve(ROOT, inputPathArg.slice('--input='.length)) : DEFAULT_CONTRACT_PATH

  const raw = await readFile(inputPath, 'utf8')
  const schema = JSON.parse(raw)
  const types = await compile(schema, 'RequestTraceV1SimReport', {
    bannerComment:
      '// AUTO-GENERATED FILE. DO NOT EDIT.\n//',
    unreachableDefinitions: true,
    additionalProperties: false
  })

  const constants = generateRuntimeConstants(schema)
  const rendered = constants ? `${types}\n${constants}\n` : types

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        `Generated request trace contract is stale. Run: bun run trace-contracts:generate`
      )
    }
    console.log('Request trace contract is up to date.')
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  console.log(`Generated request trace types -> ${OUTPUT_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
