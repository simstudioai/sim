/**
 * Prints the public CLI's command inventory as JSON, for the mothership worker's agent
 * grammar (its reference card, routing, and display names are generated from this).
 *
 * The source is `buildProgram()` — the same command tree `--help` and the generated docs
 * read — so the model's card can never describe a command the CLI does not have. Each
 * leaf carries its positionals and options as commander declares them, plus the top-level
 * shape of its JSON response resolved from the v2 OpenAPI documents.
 *
 *   bun run packages/sim-cli/scripts/print-command-inventory.ts > inventory.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { CLI_CONTRACT } from '../src/contract/commands'
import { V2_OPERATIONS } from '../src/generated/v2-api'
import { buildProgram } from '../src/program'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const HELP_COMMAND = 'help'

interface InventoryArgument {
  name: string
  required: boolean
  variadic: boolean
  description: string
}

interface InventoryOption {
  /** e.g. "--limit <n>" */
  flags: string
  name: string
  takesValue: boolean
  required: boolean
  description: string
  defaultValue?: string
}

interface InventoryShapeField {
  name: string
  type: string
}

interface InventoryCommand {
  path: string[]
  description: string
  args: InventoryArgument[]
  options: InventoryOption[]
  /** Top-level fields of the JSON response's `data`, when the operation is known. */
  shape?: InventoryShapeField[]
}

function isHiddenCommand(command: Command): boolean {
  return (command as Command & { _hidden?: boolean })._hidden === true
}

function subcommands(command: Command): Command[] {
  return command.commands.filter(
    (child) => child.name() !== HELP_COMMAND && !isHiddenCommand(child)
  )
}

function collectLeaves(command: Command, prefix: string[]): { path: string[]; command: Command }[] {
  const children = subcommands(command)
  if (children.length === 0) return [{ path: prefix, command }]
  return children.flatMap((child) => collectLeaves(child, [...prefix, child.name()]))
}

/** Command path → v2 operation name, through the contract's declared command strings. */
const OPERATION_BY_PATH = new Map<string, string>()
for (const [operation, spec] of Object.entries(CLI_CONTRACT)) {
  if (spec && 'command' in spec && typeof spec.command === 'string') {
    OPERATION_BY_PATH.set(spec.command, operation)
  }
}

type JsonSchema = {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  nullable?: boolean
  enum?: unknown[]
}

interface OpenApiDoc {
  paths: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }> }
    >
  >
  components?: { schemas?: Record<string, JsonSchema> }
}

const OPENAPI_DOCS: OpenApiDoc[] = fs
  .readdirSync(path.join(ROOT, 'apps/docs'))
  .filter((name) => /^openapi-v2-.*\.json$/.test(name))
  .map(
    (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/docs', name), 'utf8')) as OpenApiDoc
  )

function resolveRef(doc: OpenApiDoc, schema: JsonSchema | undefined): JsonSchema | undefined {
  let current = schema
  for (let hops = 0; current?.$ref && hops < 8; hops++) {
    const name = current.$ref.split('/').pop() ?? ''
    current = doc.components?.schemas?.[name]
  }
  return current
}

function typeLabel(doc: OpenApiDoc, schema: JsonSchema | undefined): string {
  const resolved = resolveRef(doc, schema)
  if (!resolved) return 'unknown'
  if (resolved.enum) return resolved.enum.map((v) => JSON.stringify(v)).join('|')
  const variants = resolved.anyOf ?? resolved.oneOf
  if (variants) return variants.map((v) => typeLabel(doc, v)).join('|')
  const type = Array.isArray(resolved.type) ? resolved.type.join('|') : resolved.type
  if (type === 'array') return `${typeLabel(doc, resolved.items)}[]`
  if (type === 'object' || resolved.properties) {
    const keys = Object.keys(resolved.properties ?? {})
    return keys.length > 0
      ? `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`
      : 'object'
  }
  return type ?? 'unknown'
}

function responseShape(operation: string): InventoryShapeField[] | undefined {
  const op = V2_OPERATIONS[operation as keyof typeof V2_OPERATIONS]
  if (!op) return undefined
  const docPath = op.path.replace(/\[([^\]]+)\]/g, '{$1}')
  for (const doc of OPENAPI_DOCS) {
    const entry = doc.paths[docPath]?.[op.method.toLowerCase()]
    const schema = entry?.responses?.['200']?.content?.['application/json']?.schema
    const resolved = resolveRef(doc, schema)
    if (!resolved) continue
    const data = resolveRef(doc, resolved.properties?.data) ?? resolved
    const props = data.properties
    if (!props) {
      const items = resolveRef(doc, data.items)
      if (items?.properties) {
        return [{ name: '[]', type: typeLabel(doc, items) }]
      }
      return undefined
    }
    return Object.entries(props).map(([name, s]) => ({ name, type: typeLabel(doc, s) }))
  }
  return undefined
}

const program = buildProgram()
const inventory: InventoryCommand[] = collectLeaves(program, []).map(
  ({ path: cmdPath, command }) => {
    const args: InventoryArgument[] = command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
      description: argument.description,
    }))
    const options: InventoryOption[] = command.options
      .filter((option) => !option.hidden)
      .map((option) => ({
        flags: option.flags,
        name: option.attributeName(),
        takesValue: option.required || option.optional,
        required: option.mandatory,
        description: option.description,
        ...(option.defaultValue !== undefined ? { defaultValue: String(option.defaultValue) } : {}),
      }))
    const operation = OPERATION_BY_PATH.get(cmdPath.join(' '))
    const shape = operation ? responseShape(operation) : undefined
    return {
      path: cmdPath,
      description: command.description(),
      args,
      options,
      ...(shape ? { shape } : {}),
    }
  }
)

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
