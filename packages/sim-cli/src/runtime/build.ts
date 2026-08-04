import { Command } from 'commander'
import { CLI_CONTRACT } from '../contract/commands.js'
import type { CommandSpec } from '../contract/types.js'
import { V2_OPERATIONS, type V2OperationName } from '../generated/v2-api.js'
import { deriveCommandPath } from './derive.js'
import { executeOperation } from './execute.js'
import { addOperationOptions } from './options.js'
import type { OperationSpec } from './types.js'

const GROUP_ALIASES: Readonly<Record<string, string>> = {
  'audit-logs': 'audit-log',
  credentials: 'credential',
  'custom-tools': 'custom-tool',
  files: 'file',
  folders: 'folder',
  logs: 'log',
  'mcp-servers': 'mcp-server',
  skills: 'skill',
  tables: 'table',
  workflows: 'workflow',
}

function buildLeaf(operation: V2OperationName, spec: CommandSpec, leafName: string): Command {
  const operationSpec = V2_OPERATIONS[operation] as OperationSpec
  const command = new Command(leafName).allowExcessArguments(false)

  for (const param of operationSpec.pathParams) {
    command.argument(`<${param}>`)
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

function groupFor(groups: Map<string, Command>, name: string): Command {
  const existing = groups.get(name)
  if (existing) return existing

  const group = new Command(name)
  const alias = GROUP_ALIASES[name]
  if (alias) group.alias(alias)
  groups.set(name, group)
  return group
}

function nestedGroup(parent: Command, name: string): Command {
  const existing = parent.commands.find((candidate) => candidate.name() === name)
  if (existing) return existing

  const created = new Command(name)
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

    if (rest.length > 1) {
      const [subName, ...tail] = rest
      nestedGroup(group, subName).addCommand(buildLeaf(operation, spec, tail.join(' ')))
      continue
    }

    group.addCommand(buildLeaf(operation, spec, leafName))
  }

  return [...groups.values()].sort((a, b) => a.name().localeCompare(b.name()))
}
