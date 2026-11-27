import { Command, type Option } from 'commander'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec, CommandVariantSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { callsOperations } from './called-operations'
import { deriveCommandPath } from './derive'
import { executeOperation } from './execute'
import { retypeApiError } from './naming'
import { addOperationOptions, JSON_PLACEHOLDER } from './options'
import { warnRenamedCommand, writeRenameWarnings } from './renamed'
import {
  flagNameFor,
  flagSpecFor,
  isProfileWorkspacePath,
  PROFILE_INJECTED_FIELD,
  RESERVED_PROGRAM_FLAGS,
  trailingListField,
} from './request'
import { shellArgument, typedCommandLine } from './run-next'
import type { OperationSpec } from './types'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
  'permission-groups': 'permission-group',
  files: 'file',
  knowledge: 'kb',
  logs: 'log',
  'mcp-servers': 'mcp-server',
  sandboxes: 'sandbox',
  schedules: 'schedule',
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

/**
 * Whether an unknown-option token reads as a resource id rather than a flag.
 *
 * `generateShortId` draws from a 64-character alphabet holding exactly one
 * `-`, so one id in 64 opens with a dash and commander parses it as an option
 * instead of the positional it was typed as — `audit-logs get` and
 * `custom-tools get/update/delete` all take such an id. A flag on this surface
 * is either a single-character short (`-w`) or a lowercase kebab-case long
 * (`--allow-delete`), so a lone dash followed by two or more characters of which at
 * least one is an uppercase letter or a digit is not a flag any caller meant
 * to type. `--organisation` and every other misspelt flag keeps the plain
 * error and commander's own suggestion.
 */
function looksLikeAnId(token: string): boolean {
  return (
    token.length > 2 && !token.startsWith('--') && /^-[\w-]+$/.test(token) && /[A-Z0-9]/.test(token)
  )
}

/**
 * The action `command` holds, if any. Commander keeps the handler off its
 * typings and offers no way to read it, so a command that wraps a generated
 * leaf's handler (`workflows source get --dir`, `workflows runs get`) reads it
 * here, and the tree, which mixes generated and hand-written commands, asks it
 * whether a command acts on its own.
 */
export function heldAction(
  command: Command | undefined
): ((args: unknown[]) => unknown) | undefined {
  const held = (command as (Command & { _actionHandler?: unknown }) | undefined)?._actionHandler
  return typeof held === 'function' ? (held as (args: unknown[]) => unknown) : undefined
}

/** Whether the command runs an action of its own rather than only dispatching to subcommands. */
function hasOwnAction(command: Command): boolean {
  return heldAction(command) !== undefined
}

function longFlagSyntax(option: Option): string {
  return option.flags.replace(/^-[A-Za-z], /, '')
}

/** The command line with its positionals and every required flag, as `--help` would read it. */
function usageExample(command: Command): string {
  const parts = [commandPath(command), argumentSyntax(command)]
  for (const option of command.options) if (option.mandatory) parts.push(longFlagSyntax(option))
  return parts.filter(Boolean).join(' ')
}

function optionList(command: Command): string {
  const flags = command.options.filter((option) => !option.hidden).map((option) => option.flags)
  return flags.length > 0
    ? `Options for ${commandPath(command)}: ${flags.join(', ')}`
    : `${commandPath(command)} takes no options.`
}

/**
 * The first unknown option commander saw. Commander files it, and every
 * operand after it, at the end of `args`; an operand never opens with a dash
 * unless it follows `--`, and then no option is unknown.
 */
function unknownOptionToken(command: Command): string | undefined {
  return command.args.find((arg) => arg.length > 1 && arg.startsWith('-'))
}

/**
 * The value a caller typed as a positional where the one missing required flag
 * was wanted (`files rename <id> new.pdf`, `knowledge search <kbId>`), when
 * that reading is the only one. An unknown option puts its own value among the
 * operands, and with two flags missing the value could belong to either, so
 * both cases name nothing (as does a dash-led operand escaped with `--`, which
 * reads the same as an unknown option here).
 */
function misplacedFlagValue(command: Command): { option: Option; value: string } | undefined {
  const missing = command.options.filter(
    (option) => option.mandatory && command.getOptionValue(option.attributeName()) === undefined
  )
  if (missing.length !== 1 || unknownOptionToken(command) !== undefined) return undefined
  if (command.registeredArguments.some((argument) => argument.variadic)) return undefined
  const extra = command.args.slice(command.registeredArguments.length)
  return extra.length === 1 ? { option: missing[0], value: extra[0] } : undefined
}

/** An option of this command or a group above it that took another of its flags as its value. */
interface SwallowedFlag {
  owner: Command
  option: Option
  /** The flag it took, as typed (`--input`, or `--input=…`). */
  taken: string
  /** The option the taken flag names. */
  takenOption: Option
}

/**
 * Each option of this command or a group above it (the root's `--workspace` too) that took a flag
 * as its value: `run <id> --allow --input '{…}'` gives `--allow` the value `--input` and leaves the
 * JSON over as a positional, so the excess is a symptom of the missing value and the JSON is not
 * misplaced.
 */
function swallowedFlags(command: Command): SwallowedFlag[] {
  const owned: { owner: Command; option: Option }[] = []
  for (let owner: Command | null = command; owner; owner = owner.parent) {
    for (const option of owner.options) owned.push({ owner, option })
  }
  return owned.flatMap(({ owner, option }) => {
    const value = owner.getOptionValue(option.attributeName())
    for (const given of Array.isArray(value) ? value : [value]) {
      if (typeof given !== 'string') continue
      const takenOption = owned.find(({ option: other }) =>
        [other.long, other.short].includes(given.split('=', 1)[0])
      )?.option
      if (takenOption) return [{ owner, option, taken: given, takenOption }]
    }
    return []
  })
}

/** What a swallowing option is for, and how to write it. */
function swallowedLine({ option, taken }: SwallowedFlag): string {
  const purpose = option.description.split(/[;(]/, 1)[0].trim()
  return `${option.long ?? option.short} took ${taken} as its value; write ${option.flags}: ${purpose}.`
}

/**
 * The command line with the one leaf option that took a flag given a placeholder value of its own,
 * and the flag it took given the operand left over: `run <id> --allow '<block>' --input '{…}'`.
 * The typed positionals and options are kept. Null when the reading is not the only one: several
 * swallowed flags, one owned by a group above the leaf, or operands that do not fit the taken flag.
 */
function swallowedExample(command: Command, swallowed: readonly SwallowedFlag[]): string | null {
  if (swallowed.length !== 1) return null
  const [{ owner, option, taken, takenOption }] = swallowed
  if (owner !== command || !option.long || !takenOption.long) return null
  const extra = command.args.slice(command.registeredArguments.length)
  const takesValue = (takenOption.required || takenOption.optional) && !taken.includes('=')
  if (extra.length !== (takesValue ? 1 : 0)) return null
  const placeholder = option.flags.slice(option.flags.lastIndexOf(' ') + 1)
  const value = command.getOptionValue(option.attributeName())
  const kept = (Array.isArray(value) ? value : []).filter(
    (given): given is string => typeof given === 'string' && given !== taken
  )
  const words = [
    typedCommandLine(
      command,
      command.args.slice(0, command.registeredArguments.length),
      new Set([option.attributeName()])
    ),
    ...kept.map((given) => `${option.long} ${shellArgument(given)}`),
    `${option.long} ${shellArgument(placeholder)}`,
    taken.includes('=') ? shellArgument(taken) : takenOption.long,
    ...extra.map(shellArgument),
  ]
  return `Example: ${words.join(' ')}`
}

/**
 * A JSON operand typed where one of the command's JSON flags (`--input <json|@file>`) was meant,
 * as the line that moves it there with the positionals and the options typed kept. Null when no operand opens like
 * JSON or names a source (`@file`, `@-`), or the command has no such flag or several to choose between.
 */
function misplacedJson(command: Command): string[] | null {
  const extra = command.args.slice(command.registeredArguments.length)
  const json = extra.find((operand) => /^\s*[[{]|^@./.test(operand))
  const owners = command.options.filter(
    (option) => !option.hidden && option.long && option.flags.endsWith(` ${JSON_PLACEHOLDER}`)
  )
  if (json === undefined || owners.length !== 1 || !owners[0].long) return null
  const flag = owners[0].long
  const positionals = command.args.slice(0, command.registeredArguments.length)
  return [
    `The JSON was passed as a positional; pass it with ${flag} '<json>' (or ${flag} @file).`,
    `Example: ${typedCommandLine(command, positionals)} ${flag} ${shellArgument(json)}`,
  ]
}

/**
 * The visible commands beside this one, or in a group beside it, that answer to a flag this one
 * does not, by any spelling (a hidden alias such as `--row-ids` too), each with its description,
 * so a read never picks a sibling that deletes. Looking one group down is what reaches `tables
 * rows batch-delete` from `tables batch-delete --row-ids`, which deletes tables, not rows.
 */
function siblingsDeclaring(command: Command, flag: string): string[] {
  const parent = command.parent
  if (!parent) return []
  const visible = (group: Command) => group.createHelp().visibleCommands(group)
  return visible(parent)
    .filter((sibling) => sibling !== command)
    .flatMap((sibling) => [sibling, ...visible(sibling)])
    .filter((candidate) =>
      candidate.options.some((option) => option.long === flag || option.short === flag)
    )
    .map((owner) => `  ${commandPath(owner)} — ${owner.description().split('\n', 1)[0]}`)
}

/**
 * Appends recovery guidance to commander's parse errors, keyed by the error
 * code commander raises, so the retry needs no `--help` round.
 *
 * - A missing positional or required flag gets the full command line, and a
 *   value typed as a positional where the flag was wanted is named against
 *   that flag when nothing else could have put it there.
 * - Too many positionals get the same command line and the flag list; an option that took
 *   another flag as its value is named, and a JSON operand is moved to the JSON flag it belongs to.
 * - An unknown option gets the command's own flags, and the sibling commands
 *   that do take it: `tables rows list --filter` belongs to `tables rows
 *   query`, which commander's near-spelling suggestion never reaches.
 * - An id swallowed as an option because it opens with a dash gets the `--`
 *   escape, which commander never mentions.
 */
function parseErrorGuidance(command: Command, code: string | undefined): string[] {
  switch (code) {
    case 'commander.missingArgument':
      return [`Example: ${usageExample(command)}`]
    case 'commander.missingMandatoryOptionValue': {
      const misplaced = misplacedFlagValue(command)
      const moved = misplaced
        ? [
            `"${misplaced.value}" was passed as a positional; pass it as ${misplaced.option.long ?? misplaced.option.short} "${misplaced.value}".`,
          ]
        : []
      return [...moved, `Example: ${usageExample(command)}`]
    }
    case 'commander.excessArguments': {
      const swallowed = swallowedFlags(command)
      const moved = swallowed.length === 0 ? misplacedJson(command) : null
      const corrected = swallowedExample(command, swallowed)
      return [
        ...swallowed.map(swallowedLine),
        ...(moved ?? [corrected ?? `Example: ${usageExample(command)}`]),
        optionList(command),
      ]
    }
    case 'commander.unknownOption': {
      const token = unknownOptionToken(command)
      if (!token) return []
      if (looksLikeAnId(token) && command.registeredArguments.length > 0) {
        return [`Example: ${commandPath(command)} -- ${token}`]
      }
      const flag = token.split('=', 1)[0]
      const owners = siblingsDeclaring(command, flag)
      return [
        optionList(command),
        ...(owners.length > 0 ? [`${flag} is an option of:`, ...owners] : []),
      ]
    }
    default:
      return []
  }
}

/**
 * Wraps the command's own `error`, which every commander parse failure on it
 * goes through. The output configuration cannot carry this: commands made with
 * `.command()` share their parent's configuration object, so a formatter set on
 * one would answer for all of them.
 */
function addParseErrorGuidance(command: Command): void {
  const error = command.error.bind(command)
  command.error = (message, options) => {
    const guidance = parseErrorGuidance(command, options?.code)
    return error(guidance.length > 0 ? `${message}\n${guidance.join('\n')}` : message, options)
  }
}

/**
 * Attaches {@link addParseErrorGuidance} to every command that parses its own
 * arguments, generated or attached by hand (`files upload`, `secrets set`), so
 * a hand-written command does not answer a guessed flag with a bare error.
 * Pure dispatchers below the root are left to commander's unknown-command handling.
 */
export function addParseErrorGuidanceToTree(program: Command): void {
  const walk = (command: Command): void => {
    const parsesOwnArguments = command.commands.length === 0 || hasOwnAction(command)
    if (parsesOwnArguments || !command.parent) addParseErrorGuidance(command)
    for (const child of command.commands) walk(child)
  }
  walk(program)
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
 * Refuses, across the assembled program, a leaf option the root would swallow:
 * generated leaves, commands attached by hand (`attachSecretCommands`,
 * `attachProtocolCommands`, `attachCredentialCommands`) and options added to a
 * leaf after it is built.
 *
 * A collision is invisible at runtime — either the root's handler answers and
 * exits `0`, or the root simply keeps the value and the leaf reads `undefined`.
 * Either way the command reports success while doing nothing the caller asked
 * for. Raising here means the CLI cannot start with one, which the command-tree
 * tests exercise on every operation, so a contract that introduces one fails in
 * CI rather than in somebody's pipeline.
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
    // `unknownCommand` is not in commander's typings, for the same reason
    // `rawArgs` is not — reaching for it is what keeps this message, its "did
    // you mean" suggestion, and its error code identical to the non-help path.
    const internals = command as Command & { unknownCommand: () => never }
    const dispatchesOnly =
      command.commands.length > 0 &&
      !hasOwnAction(command) &&
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
  // A workspace mutation is followed by reading its operation receipt under `--wait`.
  callsOperations(
    command,
    spec.workspaceOperation ? [operation, 'getWorkspaceOperation'] : [operation],
    { runs: operation }
  )
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

  const trailing = trailingListField(spec)
  if (trailing) {
    const trailingFlags = Object.values(spec.flags ?? {}).filter((flag) => flag.trailing)
    const descriptor = operationSpec.query?.[trailing] ?? operationSpec.body?.[trailing]
    if (trailingFlags.length > 1)
      throw new Error(`${operation} declares more than one trailing list`)
    if (!descriptor || !flagSpecFor(operation, trailing).list) {
      throw new Error(`${operation}.${trailing} is trailing but not a list request field`)
    }
    const name = flagNameFor(operation, trailing)
    command.argument(
      `[${name}...]`,
      `${flagSpecFor(operation, trailing).describe ?? descriptor.describe} Same as --${name}.`
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
  if (spec.helpText) command.addHelpText('after', spec.helpText)
  addOperationOptions(command, operation, spec, operationSpec)
  // The last frame that still knows which operation ran, and so the only one
  // that can say `--include-job-runs` where the server said `includeJobRuns`.
  command.action((...invocation: unknown[]) =>
    // A rename warning no result took (a failure, or a path that prints none) still reaches stderr.
    executeOperation(operation, spec, operationSpec, invocation).then(
      () => writeRenameWarnings(command),
      (error) => {
        writeRenameWarnings(command)
        throw retypeApiError(error, operation, spec, operationSpec)
      }
    )
  )
  return command
}

/**
 * Registers a command at a path it used to have, hidden and warning on use.
 *
 * The leaf is configured by the same `configureOperation` the current spelling
 * uses, so a renamed command cannot drift from the one it forwards to — there
 * is one definition and two ways to reach it.
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

  const leaf = configureOperation(new Command(rest[rest.length - 1]), operation, spec)
  leaf.hook('preAction', () => warnRenamedCommand(leaf, from, to))
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

  let parent = groupFor(groups, groupName)
  for (const segment of rest.slice(0, -1)) {
    parent = nestedGroup(parent, segment)
  }
  parent.addCommand(configureOperation(new Command(rest[rest.length - 1]), operation, spec), {
    isDefault: spec.defaultSubcommand === true,
  })
}

function variantCommandSpec(spec: CommandSpec, variant: CommandVariantSpec): CommandSpec {
  return {
    ...spec,
    command: variant.command,
    groupDefault: false,
    defaultSubcommand: undefined,
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
