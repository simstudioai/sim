import { Command } from 'commander'
import { CLI_CONTRACT } from '../contract/commands.js'
import type { CommandSpec } from '../contract/types.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { deriveCommandPath } from './derive.js'
import { executeOperation } from './execute.js'
import { addOperationOptions } from './options.js'
import { flagNameFor } from './request.js'
import type { OperationSpec } from './types.js'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
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

  for (const param of operationSpec.pathParams) {
    command.argument(`<${param}>`)
  }

  for (const field of spec.positionals ?? []) {
    const descriptor = operationSpec.query?.[field] ?? operationSpec.body?.[field]
    if (!descriptor) throw new Error(`${operation}.${field} is not a request field`)
    if (!descriptor.required) throw new Error(`${operation}.${field} is not required`)
    command.argument(`<${flagNameFor(operation, field)}>`)
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

/** Builds every JSON command described by the generated operation table. */
export function buildGeneratedCommands(): Command[] {
  const groups = new Map<string, Command>()

  for (const operation of Object.keys(V2_OPERATIONS) as V2OperationName[]) {
    const spec = CLI_CONTRACT[operation] ?? {}
    const operationSpec = V2_OPERATIONS[operation] as OperationSpec
    if (spec.hidden || operationSpec.responseMode !== 'json') continue

    const segments = spec.command ? spec.command.split(' ') : deriveCommandPath(operation)
    const [groupName, ...rest] = segments
    const leafName = rest.join(' ') || 'run'
    const group = groupFor(groups, groupName)

    if (spec.groupDefault) {
      if (rest.length > 0) throw new Error(`${operation} groupDefault must name a command group`)
      if (operationSpec.pathParams.length > 0 || spec.positionals?.length) {
        throw new Error(`${operation} groupDefault cannot require positional arguments`)
      }
      configureOperation(group, operation, spec)
      continue
    }

    if (rest.length > 1) {
      const [subName, ...tail] = rest
      nestedGroup(group, subName).addCommand(buildLeaf(operation, spec, tail.join(' ')))
      continue
    }

    group.addCommand(buildLeaf(operation, spec, leafName))
  }

  return [...groups.values()].sort((a, b) => a.name().localeCompare(b.name()))
}
