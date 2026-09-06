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
import { CLI_CONTRACT } from '#cli/contract/commands'
import {
  type CommandReference,
  commandReference,
  type ReferenceDocument,
} from '#cli/contract/reference'
import { V2_OPERATIONS, type V2OperationName } from '#cli/generated/v2-api'
import { buildProgram } from '#cli/program'
import { camel, deriveCommandPath } from '#cli/runtime/derive'
import { flagNameFor } from '#cli/runtime/request'

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

interface InventoryCommand extends CommandReference {
  path: string[]
  description: string
  args: InventoryArgument[]
  options: InventoryOption[]
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
const OPERATION_BY_PATH = new Map<string, V2OperationName>()
const operations = Object.keys(V2_OPERATIONS) as V2OperationName[]
for (const operation of operations) {
  OPERATION_BY_PATH.set(deriveCommandPath(operation).join(' '), operation)
}
for (const operation of operations) {
  const command = CLI_CONTRACT[operation]?.command
  if (command) OPERATION_BY_PATH.set(command, operation)
}

const OPENAPI_DOCS: ReferenceDocument[] = fs
  .readdirSync(path.join(ROOT, 'apps/docs'))
  .filter((name) => /^openapi-v2-.*\.json$/.test(name))
  .map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/docs', name), 'utf8')))

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
    const jsonOptions = new Set(
      options.filter((option) => /<json\|@file>/.test(option.flags)).map((option) => option.name)
    )
    const op = operation ? V2_OPERATIONS[operation] : undefined
    const jsonFields = new Map<string, string>()
    if (op && operation) {
      for (const field of Object.keys('body' in op ? op.body : {})) {
        const flag = camel(flagNameFor(operation, field))
        if (jsonOptions.has(flag)) jsonFields.set(field, flag)
      }
      for (const variant of CLI_CONTRACT[operation]?.bodyVariants ?? []) {
        if (jsonOptions.has(camel(variant.name)))
          jsonFields.set(variant.property, camel(variant.name))
      }
    }
    const reference = op ? commandReference(OPENAPI_DOCS, op, jsonFields) : {}
    return {
      path: cmdPath,
      description: command.description(),
      args,
      options,
      ...reference,
    }
  }
)

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
