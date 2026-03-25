import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CATALOG_PATH = resolve(
  ROOT,
  '../copilot/copilot/contracts/tool-catalog-v1.json'
)
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/tool-catalog-v1.ts')

function snakeToPascal(s: string): string {
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function inferTSType(values: unknown[]): string {
  const unique = [...new Set(values.filter((v) => v !== undefined && v !== null))]
  if (unique.length === 0) return 'string'
  if (unique.every((v) => typeof v === 'string')) {
    return unique.map((v) => JSON.stringify(v)).sort().join(' | ')
  }
  if (unique.every((v) => typeof v === 'boolean')) return 'boolean'
  if (unique.every((v) => typeof v === 'number')) return 'number'
  return 'string'
}

function generateInterface(tools: Record<string, unknown>[]): string {
  if (tools.length === 0) return 'export interface ToolCatalogEntry {}\n'

  const allKeys = new Set<string>()
  for (const tool of tools) {
    for (const key of Object.keys(tool)) {
      allKeys.add(key)
    }
  }

  const requiredKeys = new Set<string>()
  for (const key of allKeys) {
    if (tools.every((t) => key in t)) {
      requiredKeys.add(key)
    }
  }

  const lines: string[] = ['export interface ToolCatalogEntry {']
  for (const key of [...allKeys].sort()) {
    const values = tools.map((t) => t[key])
    const tsType = inferTSType(values)
    const optional = requiredKeys.has(key) ? '' : '?'
    lines.push(`  ${key}${optional}: ${tsType};`)
  }
  lines.push('}')
  return lines.join('\n')
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const inputPathArg = process.argv.find((arg) => arg.startsWith('--input='))
  const inputPath = inputPathArg ? resolve(ROOT, inputPathArg.slice('--input='.length)) : DEFAULT_CATALOG_PATH

  const raw = await readFile(inputPath, 'utf8')
  const catalog = JSON.parse(raw) as { version: string; tools: Record<string, unknown>[] }

  const iface = generateInterface(catalog.tools)

  const lines: string[] = [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    '// Generated from copilot/contracts/tool-catalog-v1.json',
    '//',
    '',
    iface,
    '',
  ]

  const constNames: string[] = []

  for (const tool of catalog.tools) {
    const constName = snakeToPascal(tool.id as string)
    constNames.push(constName)
    const fields: string[] = []
    for (const [key, value] of Object.entries(tool)) {
      fields.push(`  ${key}: ${JSON.stringify(value)}`)
    }
    lines.push(`export const ${constName}: ToolCatalogEntry = {`)
    lines.push(fields.join(',\n') + ',')
    lines.push('};')
    lines.push('')
  }

  lines.push(`export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {`)
  for (let i = 0; i < catalog.tools.length; i++) {
    lines.push(`  [${constNames[i]}.id]: ${constNames[i]},`)
  }
  lines.push('};')
  lines.push('')

  const rendered = lines.join('\n')

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered) {
      throw new Error(
        `Generated tool catalog is stale. Run: bun run mship-tools:generate`
      )
    }
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
}

await main()
