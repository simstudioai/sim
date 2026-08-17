import { Command } from 'commander'
import { CLI_CONTRACT } from '../contract/commands'
import type { CommandSpec, CommandVariantSpec } from '../contract/types'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api'
import { deriveCommandPath } from './derive'
import { executeOperation } from './execute'
import { addOperationOptions } from './options'
import { warnRenamedCommand } from './renamed'
import { flagNameFor, flagSpecFor, isProfileWorkspacePath, PROFILE_INJECTED_FIELD } from './request'
import type { OperationSpec } from './types'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
  files: 'file',
  knowledge: 'kb',
  logs: 'log',
  'mcp-servers': 'mcp-server',
  secrets: 'secret',
  skills: 'skill',
  tables: 'table',
  workflows: 'workflow',
  workspaces: 'workspace',
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

function addMissingArgumentExample(command: Command): Command {
  const outputError = command.configureOutput().outputError
  if (!outputError) throw new Error('Commander output formatter is not configured')

  command.configureOutput({
    outputError: (message, write) => {
      outputError(message, write)
      if (!message.startsWith('error: missing required argument ')) return

      const syntax = argumentSyntax(command)
      const example = syntax ? `${commandPath(command)} ${syntax}` : commandPath(command)
      write(`Example: ${example}\n`)
    },
  })
  return command
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
      if (!operationSpec.query?.[field] && !operationSpec.body?.[field]) {
        throw new Error(`${operation}.${field} is not a request field`)
      }
    }
    for (const slot of ['query', 'body'] as const) {
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

  command.description(
    spec.describe ?? operationSpec.summary ?? `${operationSpec.method} ${operationSpec.path}`
  )
  addOperationOptions(command, operation, spec, operationSpec)
  command.action((...invocation: unknown[]) =>
    executeOperation(operation, spec, operationSpec, invocation)
  )
  return command
}

function buildLeaf(operation: V2OperationName, spec: CommandSpec, leafName: string): Command {
  return addMissingArgumentExample(configureOperation(new Command(leafName), operation, spec))
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
  parent.addCommand(leaf, { hidden: true })
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
  parent.addCommand(created, { hidden: options.hidden })
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
    const [subName, ...tail] = rest
    nestedGroup(group, subName).addCommand(buildLeaf(operation, spec, tail.join(' ')))
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
