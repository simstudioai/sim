import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'
import { formatGeneratedSource } from './format-generated-source'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
// Matches the sibling sync scripts' canonical layout. In a repo where the Go
// service lives at `mothership/copilot`, pass `--input=` (e.g.
// `--input=../mothership/copilot/contracts/vfs-snapshot-v1.schema.json`).
const DEFAULT_CONTRACT_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/vfs-snapshot-v1.schema.json'
)
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/vfs-snapshot-v1.ts')

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputPathArg = process.argv.find((arg) => arg.startsWith('--input='))
  const inputPath = inputPathArg
    ? resolve(ROOT, inputPathArg.slice('--input='.length))
    : DEFAULT_CONTRACT_PATH

  const raw = await readFile(inputPath, 'utf8')
  const schema = JSON.parse(raw)
  const types = await compile(schema, 'VfsSnapshotV1', {
    bannerComment: '// AUTO-GENERATED FILE. DO NOT EDIT.\n//',
    unreachableDefinitions: true,
    additionalProperties: false,
  })
  const rendered = formatGeneratedSource(types, OUTPUT_PATH, ROOT)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error('Generated vfs snapshot contract is stale. Run: bun run mship:generate')
    }
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
}

await main()
