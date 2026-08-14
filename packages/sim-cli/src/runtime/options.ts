import { type Command, Option } from 'commander'
import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import {
  type FieldSpec,
  flagNameFor,
  flagSpecFor,
  PROFILE_INJECTED_FIELD,
  pathFlagNameFor,
  takesJson,
} from './request'
import type { OperationSpec } from './types'

export const DEFAULT_LIMIT = 100

function addFieldOption(
  command: Command,
  operation: V2OperationName,
  field: string,
  descriptor: FieldSpec
): void {
  if (field === PROFILE_INJECTED_FIELD || field === 'cursor') return

  const flag = flagSpecFor(operation, field)
  if (flag.omit) return

  const name = flagNameFor(operation, field)
  const short = flag.short ? `-${flag.short}, ` : ''

  if (field === 'limit' && (descriptor.kind === 'number' || descriptor.kind === 'integer')) {
    command.option(
      '--limit <n>',
      'Maximum items to return (0 for everything)',
      String(DEFAULT_LIMIT)
    )
    return
  }

  if (descriptor.kind === 'boolean' || flag.boolean) {
    if (descriptor.required) {
      command.addOption(
        new Option(
          `${short}--${name} <true|false>`,
          `${flag.describe ?? `Set ${field}`} (required)`
        )
          .choices(['true', 'false'])
          .makeOptionMandatory()
      )
      return
    }

    command.option(`${short}--${name}`, flag.describe ?? `Set ${field}`)
    if (!flag.boolean) command.option(`--no-${name}`, `Set ${field} to false`)
    return
  }

  const takesList = flag.list === true
  const wantsJson = takesJson(descriptor, flag)
  const placeholder = takesList ? '<value...>' : wantsJson ? '<json|@file>' : '<value>'
  const choices = flag.choices ?? descriptor.values
  const describe = `${flag.describe ?? `Set ${name.replaceAll('-', ' ')}`}${
    takesList
      ? ' (space-separated, or @path / @- with one value per line)'
      : wantsJson
        ? ' (JSON, or @path / @- to read a file or stdin)'
        : ''
  }${descriptor.required ? ' (required)' : ''}`

  const option = new Option(`${short}--${name} ${placeholder}`, describe)
  if (choices && !takesList) option.choices([...choices])
  if (descriptor.default !== undefined && field !== 'limit') {
    option.default(undefined, String(descriptor.default))
  }
  if (descriptor.required) option.makeOptionMandatory()
  command.addOption(option)
}

/** Adds request-field and safety options for one generated operation. */
export function addOperationOptions(
  command: Command,
  operation: V2OperationName,
  commandSpec: CommandSpec,
  operationSpec: OperationSpec
): void {
  for (const param of operationSpec.pathParams) {
    const flag = commandSpec.pathFlags?.[param]
    if (!flag) continue

    const name = pathFlagNameFor(commandSpec, param)
    const short = flag.short ? `-${flag.short}, ` : ''
    command.addOption(
      new Option(
        `${short}--${name} <${flag.placeholder ?? 'value'}>`,
        `${flag.describe ?? `Set ${name.replaceAll('-', ' ')}`} (required)`
      ).makeOptionMandatory()
    )
  }

  for (const slot of ['query', 'body'] as const) {
    for (const [field, descriptor] of Object.entries(operationSpec[slot] ?? {})) {
      if (commandSpec.requestFields && !commandSpec.requestFields.includes(field)) continue
      if (commandSpec.positionals?.includes(field)) continue
      addFieldOption(command, operation, field, descriptor)
    }
  }

  if (commandSpec.allWorkspaces) {
    command.option(
      '--all-workspaces',
      'Do not filter to the configured workspace (personal API key required for account-wide access)'
    )
  }

  if (commandSpec.expandedTrace) {
    command.option(
      '--trace',
      'Show expanded trace spans with inputs, outputs, errors, timing, and cost'
    )
  }

  if (operationSpec.opaqueBody) {
    if (commandSpec.bodyVariants) {
      for (const variant of commandSpec.bodyVariants) {
        command.option(
          `--${variant.name} <json|@file>`,
          `${variant.describe} (JSON, or @path / @-; choose exactly one body flag)`
        )
      }
    } else {
      command.requiredOption(
        '--body <json|@file>',
        'Request body as JSON (or @path / @- to read a file or stdin) (required)'
      )
    }
  }

  if (commandSpec.confirm) {
    command.option('-y, --yes', 'Skip the confirmation')
  }
}
