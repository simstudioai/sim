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
import { deriveCommandPath } from '../src/runtime/derive'

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
  /** Allowed values when the option is an enum (commander `choices`). */
  choices?: string[]
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
  /**
   * Fields of the JSON request body, two levels deep, for commands that take a
   * `<json|@file>` option — the nested payloads an agent otherwise learns from errors.
   */
  body?: InventoryShapeField[]
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

/**
 * Command path → v2 operation name. Every operation names its command the way the
 * program builder does (`deriveCommandPath`); a contract entry's explicit `command`
 * string overrides that, exactly as it does when the program is built.
 */
const OPERATION_BY_PATH = new Map<string, string>()
for (const operation of Object.keys(V2_OPERATIONS) as (keyof typeof V2_OPERATIONS)[]) {
  OPERATION_BY_PATH.set(deriveCommandPath(operation).join(' '), operation)
}
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
  const?: unknown
  required?: string[]
}

interface OpenApiDoc {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>
        requestBody?: { content?: Record<string, { schema?: JsonSchema }> }
      }
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

/**
 * A compact type for one schema. `depth` is how many object levels render their fields
 * with types (`{name:string,options:{id,name}[]}`); below it an object lists key names
 * only, as the response shapes always have.
 */
function typeLabel(
  doc: OpenApiDoc,
  schema: JsonSchema | undefined,
  depth = 0,
  enums: 'full' | 'brief' = 'full'
): string {
  const resolved = resolveRef(doc, schema)
  if (!resolved) return 'unknown'
  if (resolved.const !== undefined) return JSON.stringify(resolved.const)
  if (resolved.enum) {
    // A response is read, not written: one value and the count is enough to recognise
    // the field; a request body needs every legal value.
    if (enums === 'brief' && resolved.enum.length > 2) {
      return `${JSON.stringify(resolved.enum[0])}|…(${resolved.enum.length})`
    }
    return resolved.enum.map((v) => JSON.stringify(v)).join('|')
  }
  const variants = resolved.anyOf ?? resolved.oneOf
  if (variants) return variants.map((v) => typeLabel(doc, v, depth, enums)).join('|')
  const type = Array.isArray(resolved.type) ? resolved.type.join('|') : resolved.type
  if (type === 'array') return `${typeLabel(doc, resolved.items, depth, enums)}[]`
  if (type === 'object' || resolved.properties) {
    const props = resolved.properties ?? {}
    const keys = Object.keys(props)
    if (keys.length === 0) return 'object'
    if (depth > 0) {
      const required = new Set(resolved.required ?? [])
      return `{${keys
        .slice(0, 12)
        .map((k) => `${k}${required.has(k) ? '' : '?'}:${typeLabel(doc, props[k], depth - 1)}`)
        .join(',')}${keys.length > 12 ? ',…' : ''}}`
    }
    return `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`
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
        return [{ name: '[]', type: typeLabel(doc, items, 0, 'brief') }]
      }
      return undefined
    }
    return Object.entries(props).map(([name, s]) => ({
      name,
      type: typeLabel(doc, s, 0, 'brief'),
    }))
  }
  return undefined
}

/** The JSON request body's fields, two levels deep — only asked for commands with a `<json|@file>` option. */
function requestShape(
  operation: string,
  jsonFields: Set<string>
): InventoryShapeField[] | undefined {
  const op = V2_OPERATIONS[operation as keyof typeof V2_OPERATIONS]
  if (!op) return undefined
  const docPath = op.path.replace(/\[([^\]]+)\]/g, '{$1}')
  for (const doc of OPENAPI_DOCS) {
    const entry = doc.paths[docPath]?.[op.method.toLowerCase()]
    const schema = entry?.requestBody?.content?.['application/json']?.schema
    const resolved = resolveRef(doc, schema)
    if (!resolved?.properties) continue
    const required = new Set(resolved.required ?? [])
    const entries = Object.entries(resolved.properties)
      // The CLI injects the workspace; the model never writes it.
      .filter(([name]) => name !== 'workspaceId')
    // Scalar flags are already on the signature; the card carries the JSON-valued
    // fields only (the ones whose shape is otherwise learned from error messages).
    const nested = entries.filter(([name]) => jsonFields.has(name))
    return (nested.length > 0 ? nested : entries).map(([name, s]) => ({
      name: required.has(name) ? name : `${name}?`,
      type: capType(typeLabel(doc, s, 2)),
    }))
  }
  return undefined
}

const MAX_BODY_TYPE_CHARS = 220
const MAX_UNION_TYPE_CHARS = 600

/**
 * A recursive grammar (the row predicate) expands past what a card line can carry. A
 * union of variants gets more room: cutting it mid-list hid the operation vocabulary of
 * `operations apply` and sent an agent guessing verbs (skills run, 2026-09-02).
 */
function capType(label: string): string {
  const max = label.includes('}|{') ? MAX_UNION_TYPE_CHARS : MAX_BODY_TYPE_CHARS
  return label.length > max ? `${label.slice(0, max)}…` : label
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
        ...(option.argChoices ? { choices: option.argChoices } : {}),
      }))
    const operation = OPERATION_BY_PATH.get(cmdPath.join(' '))
    const shape = operation ? responseShape(operation) : undefined
    const jsonFields = new Set(
      options.filter((option) => /<json\|@file>/.test(option.flags)).map((option) => option.name)
    )
    const body = operation && jsonFields.size > 0 ? requestShape(operation, jsonFields) : undefined
    return {
      path: cmdPath,
      description: command.description(),
      args,
      options,
      ...(shape ? { shape } : {}),
      ...(body ? { body } : {}),
    }
  }
)

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
