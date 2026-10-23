/**
 * Prints the public CLI's command inventory as JSON, for the mothership worker's agent
 * grammar (its reference card, routing, and display names are generated from this).
 *
 * The source is `buildProgram()` — the same command tree `--help` and the generated docs
 * read — so the model's card can never describe a command the CLI does not have. Each
 * leaf carries its positionals and options as commander declares them, plus the top-level
 * shape of its JSON response resolved from the v2 OpenAPI documents, and
 * `mothershipUnavailable` when Sim refuses a Mothership caller any operation it calls.
 *
 *   bun run packages/sim-cli/scripts/print-command-inventory.ts > inventory.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { CLI_CONTRACT } from '#sim-cli/contract/commands'
import {
  type CommandReference,
  commandReference,
  type ReferenceDocument,
} from '#sim-cli/contract/reference'
import { V2_OPERATIONS, type V2OperationName } from '#sim-cli/generated/v2-api'
import { buildProgram, UNPUBLISHED_GROUPS } from '#sim-cli/program'
import { calledOperations, operationOf } from '#sim-cli/runtime/called-operations'
import { camel } from '#sim-cli/runtime/derive'
import { cursorSlot, flagNameFor } from '#sim-cli/runtime/request'

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
  /**
   * Sim refuses Mothership for an operation this command calls, so chat cannot run it.
   * Absent when every call is admitted or the command calls no known operation.
   */
  mothershipUnavailable?: true
  /** In a group hidden from `--help` until launch; the worker exposes it only when Sim enables it. */
  unpublished?: true
  /**
   * The commander aliases of each `path` segment, aligned with `path` (`kb` for `knowledge`,
   * `ls` for `list`), so the worker reads `sim kb folders ls` as the command it runs. Absent
   * when no segment has one.
   */
  pathAliases?: string[][]
  /**
   * Paths this command used to have (`tables count create` for `tables rows count`). The CLI
   * still runs each as this command, hidden from help, so the worker reads it as this one.
   */
  renamedFrom?: string[][]
}

function isHiddenCommand(command: Command): boolean {
  return (command as Command & { _hidden?: boolean })._hidden === true
}

/** Hidden commands stay out, except a whole top-level group that is only unpublished until launch. */
function subcommands(command: Command, atRoot: boolean): Command[] {
  return command.commands.filter(
    (child) =>
      child.name() !== HELP_COMMAND &&
      (!isHiddenCommand(child) || (atRoot && UNPUBLISHED_GROUPS.has(child.name())))
  )
}

interface Leaf {
  path: string[]
  /** The commands `path` names, outermost first. */
  chain: Command[]
  command: Command
}

function collectLeaves(command: Command, chain: Command[]): Leaf[] {
  const children = subcommands(command, chain.length === 0)
  if (children.length === 0) return [{ path: chain.map((node) => node.name()), chain, command }]
  return children.flatMap((child) => collectLeaves(child, [...chain, child]))
}

/**
 * Unpublished groups are documented in launch-ready definitions kept out of the public reference,
 * so their response shapes come from those definitions, as the CLI's own `--help` text does.
 */
async function unpublishedOpenApiDocuments(): Promise<ReferenceDocument[]> {
  const [
    { generateOpenApiDocument },
    { filesAuditOpenApiDocument },
    { unpublishedProjectFileDocumentation },
  ] = await Promise.all([
    import(path.join(ROOT, 'scripts/openapi/generator.ts')),
    import(path.join(ROOT, 'apps/sim/lib/api/contracts/v2/openapi/files-audit.ts')),
    import(path.join(ROOT, 'apps/sim/lib/api/contracts/v2/openapi/unpublished-project-files.ts')),
  ])
  return [
    generateOpenApiDocument({
      ...filesAuditOpenApiDocument,
      routes: unpublishedProjectFileDocumentation.routes,
    }),
  ]
}

const OPENAPI_DOCS: ReferenceDocument[] = [
  ...fs
    .readdirSync(path.join(ROOT, 'apps/docs'))
    .filter((name) => /^openapi-v2-.*\.json$/.test(name))
    .map((name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/docs', name), 'utf8'))),
  ...(await unpublishedOpenApiDocuments()),
]

/**
 * `METHOD path` of every route Sim refuses a Mothership caller, as the route inventory
 * evaluates the admission rule (`apps/sim/lib/api/server/routes/copilot-route-inventory.test.ts`).
 */
const MOTHERSHIP_REFUSED = new Set(
  (
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'apps/sim/lib/api/server/routes/copilot-refused-routes.json'),
        'utf8'
      )
    ) as { method: string; path: string }[]
  ).map((route) => `${route.method} ${route.path}`)
)

function mothershipRefuses(operations: readonly V2OperationName[]): boolean {
  return operations.some((name) => {
    const { method, path: route } = V2_OPERATIONS[name]
    return MOTHERSHIP_REFUSED.has(`${method} ${route}`)
  })
}

const program = buildProgram()
const inventory: InventoryCommand[] = collectLeaves(program, []).map(
  ({ path: cmdPath, chain, command }) => {
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
    const operation = operationOf(command)
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
    const reference = op
      ? commandReference(OPENAPI_DOCS, op, jsonFields, cursorSlot(op) !== null)
      : {}
    const called = calledOperations(command) ?? []
    const pathAliases = chain.map((node) => node.aliases())
    const contract = operation ? CLI_CONTRACT[operation] : undefined
    const renamedFrom =
      contract?.renamedFrom &&
      (contract.command === undefined || contract.command === cmdPath.join(' '))
        ? contract.renamedFrom.map((from) => from.split(' '))
        : []
    return {
      path: cmdPath,
      description: command.description(),
      args,
      options,
      ...reference,
      ...(mothershipRefuses(called) ? { mothershipUnavailable: true as const } : {}),
      ...(UNPUBLISHED_GROUPS.has(cmdPath[0] ?? '') ? { unpublished: true as const } : {}),
      ...(pathAliases.some((aliases) => aliases.length > 0) ? { pathAliases } : {}),
      ...(renamedFrom.length > 0 ? { renamedFrom } : {}),
    }
  }
)

process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
