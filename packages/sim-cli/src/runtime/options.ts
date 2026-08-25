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

/**
 * Help text for one flag, best source first.
 *
 * The CLI contract wins, because an entry there exists precisely to say
 * something the schema cannot — that `workflowIds` is really a list, or that
 * `conflictTarget` reads better as `--on`. Otherwise the field's own
 * `.describe()` from the route contract carries through: it is the same prose
 * the OpenAPI specs publish, so the terminal and the API reference explain a
 * field the same way instead of diverging.
 *
 * `Set <name>` remains as a last resort for a field that documents itself
 * nowhere. It is not documentation — it restates the flag name — so it is worth
 * treating a fallback that shows up in `--help` as a missing `.describe()` on
 * the contract rather than as finished work.
 */
function describeField(
  flag: { describe?: string },
  descriptor: FieldSpec,
  name: string,
  field: string
): string {
  return flag.describe ?? descriptor.describe ?? `Set ${name.replaceAll('-', ' ') || field}`
}

/**
 * How a nullable field is cleared, said in the flag's own help.
 *
 * The route contracts describe several of these as "send null to clear it",
 * which was true of the API and impossible from the terminal: every such flag is
 * a string, so the word `null` arrived as its four characters. Naming the
 * companion here is what stops the help promising something the CLI cannot do.
 */
function clearingHint(name: string): string {
  return ` (--no-${name} clears it)`
}

function addFieldOption(
  command: Command,
  operation: V2OperationName,
  field: string,
  descriptor: FieldSpec,
  slot: 'query' | 'body' | 'headers'
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

  const documented = describeField(flag, descriptor, name, field)

  if (descriptor.kind === 'boolean' || flag.boolean) {
    if (descriptor.required) {
      command.addOption(
        new Option(`${short}--${name} <true|false>`, `${documented} (required)`)
          .choices(['true', 'false'])
          .makeOptionMandatory()
      )
      return
    }

    command.option(`${short}--${name}`, documented)
    // The twin exists to send an explicit `false`. Restating the positive
    // flag's prose here inverts its meaning ("Return only deployed workflows"
    // on the flag that stops doing exactly that), so it names its counterpart
    // instead and lets the reader look up one description, not two.
    if (!flag.boolean) command.option(`--no-${name}`, `Send --${name} as false`)
    return
  }

  const takesList = flag.list === true
  const wantsJson = takesJson(descriptor, flag)
  const placeholder = takesList ? '<value...>' : wantsJson ? '<json|@file>' : '<value>'
  const choices = flag.choices ?? descriptor.values
  /**
   * Whether the field has a clear to offer.
   *
   * Only a body field can carry an explicit null — a query string has no way to
   * spell one — and only a field without a default is actually cleared by it:
   * where the contract declares one, the server substitutes it for the null and
   * the companion would advertise a clear that never happens.
   */
  const clearable =
    slot === 'body' &&
    descriptor.nullable === true &&
    !descriptor.required &&
    descriptor.default === undefined &&
    !takesList &&
    !wantsJson
  const describe = `${documented}${
    takesList
      ? ' (space-separated, or @path / @- with one value per line)'
      : wantsJson
        ? ' (JSON, or @path / @- to read a file or stdin)'
        : ''
  }${descriptor.required ? ' (required)' : ''}${clearable ? clearingHint(name) : ''}`

  const renamedFrom = flag.renamedFrom ?? []
  const option = new Option(`${short}--${name} ${placeholder}`, describe)
  if (flag.hidden) option.hideHelp()
  if (choices && !takesList) option.choices([...choices])
  if (descriptor.default !== undefined && field !== 'limit') {
    option.default(undefined, String(descriptor.default))
  }
  // Commander's mandatory check runs before `executeOperation` can fold a
  // renamed spelling onto the current one, so a required field that has been
  // renamed would reject the very argv this exists to keep working. The
  // requirement is not lost: `buildRequest` raises it against the current
  // spelling once both have had their chance to supply the value.
  if (descriptor.required && renamedFrom.length === 0) option.makeOptionMandatory()
  command.addOption(option)

  // Added after the positive flag so Commander does not default the field to
  // `true`, exactly as the boolean twin above relies on.
  if (clearable) command.option(`--no-${name}`, `Send --${name} as null to clear it`)

  for (const previous of renamedFrom) {
    const retired = new Option(`--${previous} ${placeholder}`).hideHelp()
    if (choices && !takesList) retired.choices([...choices])
    command.addOption(retired)
  }
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
        `${flag.describe ?? operationSpec.pathParamDocs?.[param] ?? `Set ${name.replaceAll('-', ' ')}`} (required)`
      ).makeOptionMandatory()
    )
  }

  for (const slot of ['query', 'body', 'headers'] as const) {
    for (const [field, descriptor] of Object.entries(operationSpec[slot] ?? {})) {
      if (commandSpec.requestFields && !commandSpec.requestFields.includes(field)) continue
      if (commandSpec.positionals?.includes(field)) continue
      addFieldOption(command, operation, field, descriptor, slot)
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
    // There is no prompt to skip: a `confirm` command refuses outright when the
    // flag is absent, in a TTY or not. Calling it "Skip the confirmation" sent
    // readers looking for a question the CLI never asks, and hid that the flag
    // is the only way the command ever runs.
    command.option('-y, --yes', 'Confirm this destructive operation (required)')
  }
}
