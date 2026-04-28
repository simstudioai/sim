import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/mothership-stream-v1.schema.json'
)
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/mothership-stream-v1.ts')
const RUNTIME_SCHEMA_OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/mothership-stream-v1-schema.ts'
)

function generateRuntimeConstants(schema: Record<string, unknown>, existingTypes: string): string {
  const defs = (schema.$defs ?? schema.definitions ?? {}) as Record<string, unknown>
  const lines: string[] = []

  for (const [name, def] of Object.entries(defs)) {
    if (!def || typeof def !== 'object') continue
    const defObj = def as Record<string, unknown>
    const enumValues = defObj.enum
    if (!Array.isArray(enumValues) || enumValues.length === 0) continue
    if (!enumValues.every((v) => typeof v === 'string')) continue

    const typeAlias = (enumValues as string[]).map((v) => JSON.stringify(v)).join(' | ')
    const entries = (enumValues as string[])
      .map((v) => `  ${JSON.stringify(v)}: ${JSON.stringify(v)}`)
      .join(',\n')

    if (!existingTypes.includes(`export type ${name} =`)) {
      lines.push(`export type ${name} = ${typeAlias}\n`)
    }

    lines.push(`export const ${name} = {\n${entries},\n} as const;\n`)
  }

  return lines.join('\n')
}

function renderRuntimeSchemaModule(schema: unknown): string {
  return [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    '// Generated from copilot/contracts/mothership-stream-v1.schema.json',
    '//',
    '',
    'export type JsonSchema = unknown',
    '',
    `export const MOTHERSHIP_STREAM_V1_SCHEMA: JsonSchema = ${JSON.stringify(schema, null, 2)}`,
    '',
  ].join('\n')
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputPathArg = process.argv.find((arg) => arg.startsWith('--input='))
  const inputPath = inputPathArg
    ? resolve(ROOT, inputPathArg.slice('--input='.length))
    : DEFAULT_CONTRACT_PATH

  const raw = await readFile(inputPath, 'utf8')
  const schema = JSON.parse(raw)
  const types = await compile(schema, 'MothershipStreamV1EventEnvelope', {
    bannerComment: '// AUTO-GENERATED FILE. DO NOT EDIT.\n//',
    unreachableDefinitions: true,
    additionalProperties: false,
  })

  const constants = generateRuntimeConstants(schema, types)
  const rendered = constants ? `${types}\n${constants}\n` : types
  const renderedSchemaModule = renderRuntimeSchemaModule(schema)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    const existingSchemaModule = await readFile(RUNTIME_SCHEMA_OUTPUT_PATH, 'utf8').catch(
      () => null
    )
    if (existing !== rendered || existingSchemaModule !== renderedSchemaModule) {
      throw new Error(
        `Generated mothership stream contract is stale. Run: bun run mship-contracts:generate`
      )
    }
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  await writeFile(RUNTIME_SCHEMA_OUTPUT_PATH, renderedSchemaModule, 'utf8')
}

await main()
