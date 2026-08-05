import { Command } from 'commander'
import { CLI_CONTRACT } from '../contract/commands.js'
import type { CommandSpec, CommandVariantSpec } from '../contract/types.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { deriveCommandPath } from './derive.js'
import { executeOperation } from './execute.js'
import { addOperationOptions } from './options.js'
import { flagNameFor, PROFILE_INJECTED_FIELD } from './request.js'
import type { OperationSpec } from './types.js'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
  documents: 'document',
  files: 'file',
  knowledge: 'kb',
  logs: 'log',
  'mcp-servers': 'mcp-server',
  skills: 'skill',
  tables: 'table',
  workflows: 'workflow',
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

  for (const param of operationSpec.pathParams) {
    if (spec.pathFlags?.[param]) continue
    command.argument(`<${param}>`)
  }

  for (const field of spec.positionals ?? []) {
    const descriptor = operationSpec.query?.[field] ?? operationSpec.body?.[field]
    if (!descriptor) throw new Error(`${operation}.${field} is not a request field`)
    if (spec.requestFields && !spec.requestFields.includes(field)) {
      throw new Error(`${operation}.${field} is positional but not exposed`)
    }
    command.argument(`<${flagNameFor(operation, field)}>`)
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
  return configureOperation(new Command(leafName), operation, spec)
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

function nestedGroup(parent: Command, name: string): Command {
  const existing = parent.commands.find((candidate) => candidate.name() === name)
  if (existing) return existing

  const created = new Command(name).description(
    `Manage ${resourceLabel(parent.name())} ${name.replaceAll('-', ' ')}`
  )
  parent.addCommand(created)
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

  for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
    const spec = CLI_CONTRACT[operation] ?? {}
    const operationSpec = V2_OPERATIONS[operation] as OperationSpec
    if (spec.hidden || operationSpec.responseMode !== 'json') continue

    const segments = spec.command ? spec.command.split(' ') : deriveCommandPath(operation)
    if (spec.groupDefault) {
      const [groupName, ...rest] = segments
      const group = groupFor(groups, groupName)
      if (rest.length > 0) throw new Error(`${operation} groupDefault must name a command group`)
      const pathPositionals = operationSpec.pathParams.filter((param) => !spec.pathFlags?.[param])
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
  }

  return [...groups.values()].sort((a, b) => a.name().localeCompare(b.name()))
}
