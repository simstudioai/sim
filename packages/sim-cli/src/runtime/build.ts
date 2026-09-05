import { Command } from 'commander'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec, CommandVariantSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { deriveCommandPath } from './derive'
import { executeOperation } from './execute'
import { retypeApiError } from './naming'
import { addOperationOptions } from './options'
import { warnRenamedCommand } from './renamed'
import {
  flagNameFor,
  flagSpecFor,
  isProfileWorkspacePath,
  PROFILE_INJECTED_FIELD,
  RESERVED_PROGRAM_FLAGS,
} from './request'
import type { OperationSpec } from './types'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
  files: 'file',
  knowledge: 'kb',
  logs: 'log',
  'mcp-servers': 'mcp-server',
  sandboxes: 'sandbox',
  secrets: 'secret',
  skills: 'skill',
  tables: 'table',
  workflows: 'workflow',
  workspaces: 'workspace',
}

/**
 * States the workspace-key restriction the way every generated command states it.
 *
 * The suffix lives here, once, because a fully hand-written command renders its
 * own `.description()` and never reaches the generated path — three commands
 * (`secrets set`, `credentials create`, `credentials connect`/`reconnect`) sat
 * beside siblings that carried the warning and silently read as accepting a
 * workspace key. Taking the `OperationSpec` rather than a boolean means a
 * caller has to name the operation it actually calls, so the two cannot drift.
 */
export function describeOperation(operationSpec: OperationSpec, described: string): string {
  return operationSpec.workspaceKeyUnsupported
    ? `${described} (OAuth login or personal API key required)`
    : described
}

function argumentSyntax(command: Command): string {
  return command.registeredArguments
    .map((argument) => {
      const name = `${argument.name()}${argument.variadic ? '...' : ''}`
      return argument.required ? `<${name}>` : `[${name}]`
    })
    .join(' ')
}

function commandPath(command: Command): string {
  const names: string[] = []
  let current: Command | null = command
  while (current) {
    names.unshift(current.name())
    current = current.parent
  }
  return names.join(' ')
}

const UNKNOWN_OPTION_TOKEN = /^error: unknown option '(.+?)'/

/**
 * Whether an unknown-option token reads as a resource id rather than a flag.
 *
 * `generateShortId` draws from a 64-character alphabet holding exactly one
 * `-`, so one id in 64 opens with a dash and commander parses it as an option
 * instead of the positional it was typed as — `audit-logs get` and
 * `custom-tools get/update/delete` all take such an id. A flag on this surface
 * is either a single-character short (`-w`) or a lowercase kebab-case long
 * (`--dry-run`), so a lone dash followed by two or more characters of which at
 * least one is an uppercase letter or a digit is not a flag any caller meant
 * to type. `--organisation` and every other misspelt flag keeps the plain
 * error and commander's own suggestion.
 */
function looksLikeAnId(token: string): boolean {
  return (
    token.length > 2 &&
    !token.startsWith('--') &&
    /^-[A-Za-z0-9_-]*[A-Z0-9][A-Za-z0-9_-]*$/.test(token)
  )
}

/**
 * Appends a worked example to the parse errors a positional argument causes.
 *
 * Covers the argument being absent and the argument being swallowed as an
 * option because its id opens with a dash; the second needs the `--` escape,
 * which commander never mentions.
 */
function addArgumentExamples(command: Command): Command {
  const outputError = command.configureOutput().outputError
  if (!outputError) throw new Error('Commander output formatter is not configured')

  command.configureOutput({
    outputError: (message, write) => {
      outputError(message, write)

      if (message.startsWith('error: missing required argument ')) {
        const syntax = argumentSyntax(command)
        const example = syntax ? `${commandPath(command)} ${syntax}` : commandPath(command)
        write(`Example: ${example}\n`)
        return
      }

      if (command.registeredArguments.length === 0) return
      const token = UNKNOWN_OPTION_TOKEN.exec(message)?.[1]
      if (!token || !looksLikeAnId(token)) return
      write(`Example: ${commandPath(command)} -- ${token}\n`)
    },
  })
  return command
}

/**
 * Refuses a leaf option the root program would swallow.
 *
 * A collision is invisible at runtime — either the root's handler answers and
 * exits `0`, or the root simply keeps the value and the leaf reads `undefined`.
 * Either way the command reports success while doing nothing the caller asked
 * for. Raising here means the CLI cannot start with one, which the command-tree
 * tests exercise on every operation, so a contract that introduces one fails in
 * CI rather than in somebody's pipeline.
 */
function assertNoReservedFlags(command: Command, operation: V2OperationName): void {
  for (const option of command.options) {
    for (const flag of [option.long, option.short]) {
      if (flag && RESERVED_PROGRAM_FLAGS.has(flag)) {
        throw new Error(
          `${operation} declares ${flag}, which the root program already owns; give the flag another name`
        )
      }
    }
  }
}

/**
 * Commands allowed to re-declare a flag the root owns, by full command path.
 *
 * `profiles add` declares `-w, --workspace` so that its own `--help` names the
 * workspace it takes. Its action never reads the leaf option: it reads
 * `globalsOf(command).workspace`, which is the root's value — the very value
 * the root swallowed. The declaration is help text, so the collision is
 * deliberate and inert.
 */
const RESERVED_FLAG_EXEMPTIONS: ReadonlySet<string> = new Set(['profiles add'])

/**
 * Sweeps the assembled program for a flag the root already owns.
 *
 * `assertNoReservedFlags` runs while a generated leaf is configured, so it sees
 * nothing that is attached by hand (`attachSecretCommands`,
 * `attachProtocolCommands`, `attachCredentialCommands`) or added to a leaf
 * after it is built. Walking the finished tree is what covers those.
 */
export function assertNoReservedProgramFlags(program: Command): void {
  const walk = (command: Command, prefix: string[]): void => {
    const path = [...prefix, command.name()]
    const name = path.join(' ')
    if (!RESERVED_FLAG_EXEMPTIONS.has(name)) {
      for (const option of command.options) {
        for (const flag of [option.long, option.short]) {
          if (flag && RESERVED_PROGRAM_FLAGS.has(flag)) {
            throw new Error(
              `"sim ${name}" declares ${flag}, which the root program already owns; give the flag another name`
            )
          }
        }
      }
    }
    for (const child of command.commands) walk(child, path)
  }
  for (const child of program.commands) walk(child, [])
}

/**
 * Refuses `--help` typed after a command that does not exist.
 *
 * Commander answers a help flag before it looks at the operands, so `sim
 * workspaces zzzz --help` printed the group's help and exited `0` while the
 * same words without the flag exit `1`. A capability probe reading the exit
 * code therefore concluded a command exists when it does not.
 *
 * Only pure dispatchers are guarded. A command that takes arguments or acts on
 * its own (`sim files restore <fileId>`, `sim profiles`) legitimately sees an
 * operand it did not register as a subcommand, and refusing there would break
 * `--help` on argv the CLI accepts.
 */
export function refuseHelpAfterUnknownCommand(program: Command): void {
  const walk = (command: Command): void => {
    // Neither the action handler nor `unknownCommand` is in commander's
    // typings, for the same reason `rawArgs` is not — reaching for them is what
    // keeps this message, its "did you mean" suggestion, and its error code
    // identical to the non-help path.
    const internals = command as Command & {
      _actionHandler?: unknown
      unknownCommand: () => never
    }
    const dispatchesOnly =
      command.commands.length > 0 &&
      !internals._actionHandler &&
      command.registeredArguments.length === 0

    if (dispatchesOnly) {
      const known = new Set<string>(['help'])
      for (const child of command.commands) {
        known.add(child.name())
        for (const alias of child.aliases()) known.add(alias)
      }
      // `beforeHelp` fires inside `outputHelp()`, before a byte is written, and
      // by then commander has already assigned the parsed operands.
      command.on('beforeHelp', () => {
        const first = command.args[0]
        if (first === undefined || first.startsWith('-') || known.has(first)) return
        internals.unknownCommand()
      })
    }

    for (const child of command.commands) walk(child)
  }
  walk(program)
}

function configureOperation(
  command: Command,
  operation: V2OperationName,
  spec: CommandSpec
): Command {
  const operationSpec = V2_OPERATIONS[operation] as OperationSpec
  command.allowExcessArguments(false)

  for (const alias of spec.aliases ?? []) command.alias(alias)

  for (const param of Object.keys(spec.pathFlags ?? {})) {
    if (!operationSpec.pathParams.includes(param)) {
      throw new Error(`${operation}.${param} is not a path parameter`)
    }
  }

  for (const param of Object.keys(spec.pathArgumentNames ?? {})) {
    if (!operationSpec.pathParams.includes(param)) {
      throw new Error(`${operation}.${param} is not a path parameter`)
    }
    if (spec.pathFlags?.[param]) {
      throw new Error(`${operation}.${param} cannot be both a path argument and a path flag`)
    }
  }

  if (spec.profileWorkspacePath) {
    if (!operationSpec.pathParams.includes(PROFILE_INJECTED_FIELD)) {
      throw new Error(`${operation}.profileWorkspacePath requires a workspaceId path parameter`)
    }
    if (spec.pathFlags?.[PROFILE_INJECTED_FIELD]) {
      throw new Error(`${operation}.workspaceId cannot be both profile-injected and a path flag`)
    }
  }

  for (const param of operationSpec.pathParams) {
    if (spec.pathFlags?.[param] || isProfileWorkspacePath(spec, param)) continue
    command.argument(
      `<${spec.pathArgumentNames?.[param] ?? param}>`,
      operationSpec.pathParamDocs?.[param]
    )
  }

  if (spec.allWorkspaces) {
    const workspace = operationSpec.query?.workspaceId ?? operationSpec.body?.workspaceId
    if (!workspace || workspace.required) {
      throw new Error(`${operation}.allWorkspaces requires an optional workspaceId field`)
    }
  }

  for (const field of spec.positionals ?? []) {
    const descriptor = operationSpec.query?.[field] ?? operationSpec.body?.[field]
    if (!descriptor) throw new Error(`${operation}.${field} is not a request field`)
    if (spec.requestFields && !spec.requestFields.includes(field)) {
      throw new Error(`${operation}.${field} is positional but not exposed`)
    }
    // A field promoted to a positional keeps the prose it would have carried as
    // a flag; the promotion changes where the value is typed, not what it means.
    command.argument(
      `<${flagNameFor(operation, field)}>`,
      flagSpecFor(operation, field).describe ?? descriptor.describe
    )
  }

  if (spec.requestFields) {
    for (const field of spec.requestFields) {
      if (
        !operationSpec.query?.[field] &&
        !operationSpec.body?.[field] &&
        !operationSpec.headers?.[field]
      ) {
        throw new Error(`${operation}.${field} is not a request field`)
      }
    }
    for (const slot of ['query', 'body', 'headers'] as const) {
      for (const [field, descriptor] of Object.entries(operationSpec[slot] ?? {})) {
        if (
          descriptor.required &&
          field !== PROFILE_INJECTED_FIELD &&
          !spec.requestFields.includes(field)
        ) {
          throw new Error(`${operation}.${field} is required but not exposed`)
        }
      }
    }
  }

  // Appended after the whole fallback chain, not inside the summary branch: a
  // command with a hand-written `describe` needs the restriction stated just as
  // much as one falling back to the spec summary.
  command.description(
    describeOperation(
      operationSpec,
      spec.describe ?? operationSpec.summary ?? `${operationSpec.method} ${operationSpec.path}`
    )
  )
  addOperationOptions(command, operation, spec, operationSpec)
  assertNoReservedFlags(command, operation)
  // The last frame that still knows which operation ran, and so the only one
  // that can say `--include-job-runs` where the server said `includeJobRuns`.
  command.action((...invocation: unknown[]) =>
    executeOperation(operation, spec, operationSpec, invocation).catch((error) => {
      throw retypeApiError(error, operation, spec, operationSpec)
    })
  )
  return command
}

function buildLeaf(operation: V2OperationName, spec: CommandSpec, leafName: string): Command {
  return addArgumentExamples(configureOperation(new Command(leafName), operation, spec))
}

/**
 * Registers a command at a path it used to have, hidden and warning on use.
 *
 * The leaf is built by the same `buildLeaf` the current spelling uses, so a
 * renamed command cannot drift from the one it forwards to — there is one
 * definition and two ways to reach it.
 *
 * Commander resolves a subcommand before it fills a positional, so a rename
 * that turned a group into a leaf (`files restore create` into `files restore`)
 * still parses: `create` is matched as the hidden subcommand rather than being
 * read as the file id. The cost is that a resource whose id is literally
 * `create` cannot be addressed through the current spelling, which no id
 * generated by `@sim/utils/id` ever is.
 */
function addRenamedCommand(
  groups: Map<string, Command>,
  operation: V2OperationName,
  spec: CommandSpec,
  from: string,
  to: string
): void {
  const segments = from.split(' ')
  const [groupName, ...rest] = segments
  if (rest.length === 0) throw new Error(`${operation}.renamedFrom "${from}" must include a verb`)

  let parent = groupFor(groups, groupName)
  for (const segment of rest.slice(0, -1)) {
    parent = nestedGroup(parent, segment, { hidden: true })
  }

  const leaf = buildLeaf(operation, spec, rest[rest.length - 1])
  leaf.hook('preAction', () => warnRenamedCommand(from, to))
  addSubcommand(parent, leaf, { hidden: true })
}

/**
 * Attaches a subcommand without letting it rewrite the parent's usage line.
 *
 * Commander derives that line from `commands.length` alone, so hanging the
 * retired `files restore create` under the live `files restore` leaf made its
 * help read `sim files restore [options] [command] <fileId>` — a subcommand slot
 * with nothing visible to put in it, on the only leaf of the whole surface that
 * advertised one. Pinning the line the leaf already had leaves the retired
 * spelling working, warning, and out of the help.
 */
function addSubcommand(parent: Command, child: Command, options: { hidden?: boolean } = {}): void {
  const wasLeaf = parent.commands.length === 0 && parent.registeredArguments.length > 0
  const usage = wasLeaf ? parent.usage() : null
  parent.addCommand(child, { hidden: options.hidden })
  if (usage !== null) parent.usage(usage)
}

function groupFor(groups: Map<string, Command>, name: string): Command {
  const existing = groups.get(name)
  if (existing) return existing

  const group = new Command(name).description(`Manage ${name.replaceAll('-', ' ')}`)
  const alias = GROUP_ALIASES[name]
  if (alias) group.alias(alias)
  groups.set(name, group)
  return group
}

function resourceLabel(name: string): string {
  const label = name.endsWith('s') ? name.slice(0, -1) : name
  return label.replaceAll('-', ' ')
}

/**
 * `hidden` applies only when this call is what creates the group. A rename that
 * reaches through a group the current surface also uses (`tables rows`) must
 * leave it in help; only a group resurrected solely to host a renamed leaf
 * (`tables count`) stays hidden.
 */
function nestedGroup(parent: Command, name: string, options: { hidden?: boolean } = {}): Command {
  const existing = parent.commands.find((candidate) => candidate.name() === name)
  if (existing) return existing

  const created = new Command(name).description(
    `Manage ${resourceLabel(parent.name())} ${name.replaceAll('-', ' ')}`
  )
  addSubcommand(parent, created, { hidden: options.hidden })
  return created
}

function addLeafCommand(
  groups: Map<string, Command>,
  operation: V2OperationName,
  spec: CommandSpec,
  segments: string[]
): void {
  const [groupName, ...rest] = segments
  if (rest.length === 0) throw new Error(`${operation} leaf command must include a verb`)
  const group = groupFor(groups, groupName)

  if (rest.length > 1) {
    let parent = group
    for (const segment of rest.slice(0, -1)) {
      parent = nestedGroup(parent, segment)
    }
    parent.addCommand(buildLeaf(operation, spec, rest[rest.length - 1]))
    return
  }

  group.addCommand(buildLeaf(operation, spec, rest[0]))
}

function variantCommandSpec(spec: CommandSpec, variant: CommandVariantSpec): CommandSpec {
  return {
    ...spec,
    command: variant.command,
    groupDefault: false,
    aliases: [],
    positionals: variant.positionals,
    requestFields: variant.requestFields,
    variants: [],
    describe: variant.describe ?? spec.describe,
  }
}

/** Builds every JSON command described by the generated operation table. */
export function buildGeneratedCommands(): Command[] {
  const groups = new Map<string, Command>()
  const renamed: Array<{
    operation: V2OperationName
    spec: CommandSpec
    from: string
    to: string
  }> = []

  for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
    const spec = CLI_CONTRACT[operation] ?? {}
    const operationSpec = V2_OPERATIONS[operation] as OperationSpec
    if (spec.hidden || operationSpec.responseMode !== 'json') continue

    const segments = spec.command ? spec.command.split(' ') : deriveCommandPath(operation)
    if (spec.groupDefault) {
      const [groupName, ...rest] = segments
      const group = groupFor(groups, groupName)
      if (rest.length > 0) throw new Error(`${operation} groupDefault must name a command group`)
      const pathPositionals = operationSpec.pathParams.filter(
        (param) => !spec.pathFlags?.[param] && !isProfileWorkspacePath(spec, param)
      )
      if (pathPositionals.length > 0 || spec.positionals?.length) {
        throw new Error(`${operation} groupDefault cannot require positional arguments`)
      }
      configureOperation(group, operation, spec)
    } else {
      addLeafCommand(groups, operation, spec, segments)
    }

    for (const variant of spec.variants ?? []) {
      addLeafCommand(
        groups,
        operation,
        variantCommandSpec(spec, variant),
        variant.command.split(' ')
      )
    }

    for (const from of spec.renamedFrom ?? []) {
      renamed.push({ operation, spec, from, to: segments.join(' ') })
    }
  }

  // Second pass on purpose. Commander resolves a duplicate name to whichever
  // was registered first, so registering every current spelling before any
  // renamed one makes it impossible for a retired path to shadow a live command
  // that happens to reuse its name.
  for (const { operation, spec, from, to } of renamed) {
    addRenamedCommand(groups, operation, spec, from, to)
  }

  return [...groups.values()].sort((a, b) => a.name().localeCompare(b.name()))
}
