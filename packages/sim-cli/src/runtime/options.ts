import { type Command, Option } from 'commander'
import type { CommandSpec } from '../contract/types'
import type { V2OperationName } from '../generated/v2-api'
import {
  cursorSlot,
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
 * The one instruction a route contract gives that a terminal cannot follow.
 *
 * Several v2 body fields document themselves as changed by sending JSON `null`,
 * which is accurate for the API and untypeable here: those fields are string
 * flags, so `--description null` sends the four characters. The contract prose
 * is correct and stays as written; this warns the reader that the literal is
 * all they can type, without inventing a substitute — an empty string empties a
 * description but is not what `null` means on, say, `oauthClientSecret`.
 */
function literalNullHint(documented: string, name: string): string {
  return /\bnull\b/i.test(documented) ? ` (--${name} null sends the word, not JSON null)` : ''
}

/**
 * The wire's boolean vocabulary, which a bare flag cannot offer.
 *
 * A boolean query param documents the spellings an HTTP caller may send
 * (`true`, `1`, `yes`, `on`, …) and closes by saying the listed ones are the
 * whole accepted set. That is correct for the API and publishes unchanged in
 * the OpenAPI specs, but this CLI renders those fields as a bare `--flag` and
 * its `--no-flag` twin, neither of which takes a value — so the sentence points
 * at a list the reader is never shown, in `--help` and in the generated
 * reference alike. Dropping it here keeps the terminal honest without weakening
 * the prose REST callers actually need.
 */
const WIRE_VOCABULARY_SENTENCE = /\s*The listed spellings[^.]*\.\s*/g

function withoutWireVocabulary(documented: string): string {
  return documented.replace(WIRE_VOCABULARY_SENTENCE, ' ').trim()
}

/**
 * What `--limit` means on a filtered batch operation that does not paginate.
 *
 * The pager's `0 for everything` spelling is false here: these routes bound the
 * field at `1`, and the unbounded form is the flag left off entirely. Said in
 * `--help` because nothing else in the terminal says it — the refusal only
 * arrives from the server, after the caller has already typed the command.
 *
 * Gated on the operation actually taking a `--filter`, because a non-paginating
 * `limit` is not always a match cap: `files read --limit` bounds a line range,
 * and telling its reader the flag "caps a --filter match" names a flag that
 * command does not have.
 */
const NON_PAGINATED_LIMIT_HINT =
  ' (caps a --filter match only; omit it to act on every match, and note 0 is not accepted)'

function addFieldOption(
  command: Command,
  operation: V2OperationName,
  field: string,
  descriptor: FieldSpec,
  slot: 'query' | 'body' | 'headers',
  paginates: boolean,
  capsAFilter: boolean
): void {
  if (field === PROFILE_INJECTED_FIELD || field === 'cursor') return

  const flag = flagSpecFor(operation, field)
  if (flag.omit) return

  const name = flagNameFor(operation, field)
  const short = flag.short ? `-${flag.short}, ` : ''

  // Gated on the operation actually paginating, not on the field's name: a
  // `limit` on a non-paginating operation is a row cap the wire reads
  // literally, and commander's `100` default rode into the body of every
  // filtered `tables rows batch-delete` as a silent ceiling on what it deleted.
  if (
    paginates &&
    field === 'limit' &&
    (descriptor.kind === 'number' || descriptor.kind === 'integer')
  ) {
    command.option(
      '--limit <n>',
      'Maximum items to return (0 for everything)',
      String(DEFAULT_LIMIT)
    )
    return
  }

  const documented = `${describeField(flag, descriptor, name, field)}${
    capsAFilter &&
    field === 'limit' &&
    (descriptor.kind === 'number' || descriptor.kind === 'integer')
      ? NON_PAGINATED_LIMIT_HINT
      : ''
  }`

  if (descriptor.kind === 'boolean' || flag.boolean) {
    const booleanDoc = withoutWireVocabulary(documented)
    if (descriptor.required) {
      command.addOption(
        new Option(`${short}--${name} <true|false>`, `${booleanDoc} (required)`)
          .choices(['true', 'false'])
          .makeOptionMandatory()
      )
      return
    }

    command.option(`${short}--${name}`, booleanDoc)
    // The twin exists to send an explicit `false`. Restating the positive
    // flag's prose here inverts its meaning ("Return only deployed workflows"
    // on the flag that stops doing exactly that), so it names its counterpart
    // instead and lets the reader look up one description, not two.
    if (!flag.boolean || flag.negatable) {
      command.option(`--no-${name}`, `Send --${name} as false`)
    }
    return
  }

  const takesList = flag.list === true
  const wantsJson = takesJson(descriptor, flag)
  const placeholder = takesList
    ? '<value...>'
    : flag.rowCap
      ? '<n>'
      : wantsJson
        ? '<json|@file>'
        : '<value>'
  const choices = flag.choices ?? descriptor.values
  /**
   * Only a body field reaches the wire as JSON, and only a plain scalar flag is
   * stuck with the literal: a `<json|@file>` flag parses `null` into the value.
   */
  const literalNull = slot === 'body' && !takesList && !wantsJson
  const describe = `${documented}${
    takesList
      ? flag.manifest
        ? ' (space-separated, or @path / @- with one value per line; in a file, blank lines and # comments are ignored, while inline values are sent as typed and may not be empty; @@value for a literal leading @)'
        : ' (space-separated, or @path / @- with one value per line; @@value for a literal leading @)'
      : wantsJson
        ? ' (JSON, or @path / @- to read a file or stdin)'
        : ''
  }${descriptor.required ? ' (required)' : ''}${literalNull ? literalNullHint(documented, name) : ''}`

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

  const paginates = cursorSlot(operationSpec) !== null
  const capsAFilter = (['query', 'body', 'headers'] as const).some(
    (slot) => operationSpec[slot] !== undefined && 'filter' in operationSpec[slot]
  )
  for (const slot of ['query', 'body', 'headers'] as const) {
    for (const [field, descriptor] of Object.entries(operationSpec[slot] ?? {})) {
      if (commandSpec.requestFields && !commandSpec.requestFields.includes(field)) continue
      if (commandSpec.positionals?.includes(field)) continue
      addFieldOption(command, operation, field, descriptor, slot, paginates, capsAFilter)
    }
  }

  if (commandSpec.allWorkspaces) {
    command.option(
      '--all-workspaces',
      'Do not filter to the configured workspace (OAuth login or personal API key required for account-wide access)'
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
    // A dry run is exempt at the gate itself, so on an operation that accepts
    // `--dry-run` the flag is not unconditionally required and saying so
    // outright would send a caller reaching for `--yes` to preview a change.
    const exemptedByDryRun =
      operationSpec.query?.dryRun !== undefined || operationSpec.body?.dryRun !== undefined
    // Not "destructive": the gate also covers operations that only add —
    // `files unzip` writes the archive's contents into the workspace and
    // destroys nothing — so the adjective was wrong on the help line while the
    // refusal itself, which states the operation's own consequence, was right.
    command.option(
      '-y, --yes',
      exemptedByDryRun
        ? 'Confirm this operation (required unless --dry-run)'
        : 'Confirm this operation (required)'
    )
  }
}
