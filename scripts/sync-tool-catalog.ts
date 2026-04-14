import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const DEFAULT_CATALOG_PATH = resolve(ROOT, '../copilot/copilot/contracts/tool-catalog-v1.json')
const OUTPUT_PATH = resolve(ROOT, 'apps/sim/lib/copilot/generated/tool-catalog-v1.ts')
const RUNTIME_SCHEMA_OUTPUT_PATH = resolve(
  ROOT,
  'apps/sim/lib/copilot/generated/tool-schemas-v1.ts'
)

function snakeToPascal(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

function toCamelIdentifier(value: string): string {
  const parts = value.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return 'value'

  const camel = parts
    .map((part, index) => {
      const lower = part.toLowerCase()
      if (index === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')

  return /^[0-9]/.test(camel) ? `v${camel}` : camel
}

function getTopLevelOperationEnum(tool: Record<string, unknown>): string[] | undefined {
  const parameters =
    typeof tool.parameters === 'object' && tool.parameters !== null
      ? (tool.parameters as Record<string, unknown>)
      : null
  const properties =
    parameters && typeof parameters.properties === 'object' && parameters.properties !== null
      ? (parameters.properties as Record<string, unknown>)
      : null
  const operation =
    properties && typeof properties.operation === 'object' && properties.operation !== null
      ? (properties.operation as Record<string, unknown>)
      : null
  const values = operation?.enum

  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    return undefined
  }
  return values as string[]
}

function inferTSType(values: unknown[]): string {
  const unique = [...new Set(values.filter((v) => v !== undefined && v !== null))]
  if (unique.length === 0) return 'string'
  if (unique.every((v) => typeof v === 'string')) {
    return unique
      .map((v) => JSON.stringify(v))
      .sort()
      .join(' | ')
  }
  if (unique.every((v) => typeof v === 'boolean')) return 'boolean'
  if (unique.every((v) => typeof v === 'number')) return 'number'
  return 'unknown'
}

function renderRuntimeSchemaModule(catalog: { tools: Record<string, unknown>[] }): string {
  const lines: string[] = [
    '// AUTO-GENERATED FILE. DO NOT EDIT.',
    '// Generated from copilot/contracts/tool-catalog-v1.json',
    '//',
    '',
    'export type JsonSchema = unknown',
    '',
    'export interface ToolRuntimeSchemaEntry {',
    '  parameters?: JsonSchema;',
    '  resultSchema?: JsonSchema;',
    '}',
    '',
    'export const TOOL_RUNTIME_SCHEMAS: Record<string, ToolRuntimeSchemaEntry> = {',
  ]

  for (const tool of catalog.tools) {
    const id = JSON.stringify(tool.id)
    const parameters =
      'parameters' in tool ? JSON.stringify(tool.parameters ?? null, null, 2) : 'undefined'
    const resultSchema =
      'resultSchema' in tool ? JSON.stringify(tool.resultSchema ?? null, null, 2) : 'undefined'
    lines.push(`  [${id}]: {`)
    lines.push(
      `    parameters: ${parameters === 'null' ? 'undefined' : parameters.replace(/\n/g, '\n    ')},`
    )
    lines.push(
      `    resultSchema: ${resultSchema === 'null' ? 'undefined' : resultSchema.replace(/\n/g, '\n    ')},`
    )
    lines.push('  },')
  }

  lines.push('}')
  lines.push('')
  return lines.join('\n')
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
  const inputPath = inputPathArg
    ? resolve(ROOT, inputPathArg.slice('--input='.length))
    : DEFAULT_CATALOG_PATH

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
    lines.push(`${fields.join(',\n')},`)
    lines.push('};')
    lines.push('')
  }

  for (const tool of catalog.tools) {
    const constName = snakeToPascal(tool.id as string)
    const operationEnum = getTopLevelOperationEnum(tool)
    if (!operationEnum || operationEnum.length === 0) continue

    const operationConstName = `${constName}Operation`
    const seenKeys = new Set<string>()
    const members = operationEnum.map((value, index) => {
      let key = toCamelIdentifier(value)
      if (seenKeys.has(key)) key = `${key}${index + 1}`
      seenKeys.add(key)
      return { key, value }
    })

    lines.push(`export const ${operationConstName} = {`)
    for (const member of members) {
      lines.push(`  ${member.key}: ${JSON.stringify(member.value)},`)
    }
    lines.push('} as const;')
    lines.push('')
    lines.push(
      `export type ${operationConstName} = (typeof ${operationConstName})[keyof typeof ${operationConstName}];`
    )
    lines.push('')
    lines.push(`export const ${operationConstName}Values = [`)
    for (const member of members) {
      lines.push(`  ${operationConstName}.${member.key},`)
    }
    lines.push(`] as const;`)
    lines.push('')
  }

  lines.push(`export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {`)
  for (let i = 0; i < catalog.tools.length; i++) {
    lines.push(`  [${constNames[i]}.id]: ${constNames[i]},`)
  }
  lines.push('};')
  lines.push('')

  const rendered = lines.join('\n')
  const runtimeSchemaRendered = renderRuntimeSchemaModule(catalog)

  if (checkOnly) {
    const existing = await readFile(OUTPUT_PATH, 'utf8').catch(() => null)
    const existingRuntime = await readFile(RUNTIME_SCHEMA_OUTPUT_PATH, 'utf8').catch(() => null)
    if (existing !== rendered || existingRuntime !== runtimeSchemaRendered) {
      throw new Error(`Generated tool catalog is stale. Run: bun run mship-tools:generate`)
    }
    return
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, rendered, 'utf8')
  await mkdir(dirname(RUNTIME_SCHEMA_OUTPUT_PATH), { recursive: true })
  await writeFile(RUNTIME_SCHEMA_OUTPUT_PATH, runtimeSchemaRendered, 'utf8')
}

await main()
