import type { Command } from 'commander'
import { writeStderr } from '#sim-cli/output/io'

/**
 * Support for spellings the CLI has moved on from.
 *
 * A rename is not an alias. {@link CommandSpec.aliases} are ergonomic shorthands
 * — `ls`, `mv` — that the CLI wants people to use, so they appear in help. A
 * renamed spelling is kept only so a script written against the old name keeps
 * working: it stays out of help and out of the generated docs, and says what to
 * write instead.
 *
 * The old name is most likely to survive inside exactly the kind of script that
 * reads the result as JSON, often with stderr merged in (`2>&1`), so the warning
 * is owed to the invocation and delivered with its result: inside a JSON or YAML
 * result as its `note`, and on stderr for a person (`renderResult`). A command
 * that ends without a result to carry it says it on stderr ({@link writeRenameWarnings}).
 */

/** The warnings each invoked command owes, until its result or its failure delivers them. */
const OWED = new WeakMap<Command, string[]>()

function owe(command: Command, kind: string, from: string, to: string): void {
  const warnings = OWED.get(command) ?? []
  warnings.push(`${kind} "${from}" has been renamed to "${to}". The old name still works.`)
  OWED.set(command, warnings)
}

/** Owes `command` the warning that it was invoked by a path it has been renamed from. */
export function warnRenamedCommand(command: Command, from: string, to: string): void {
  owe(command, 'command', `sim ${from}`, `sim ${to}`)
}

/** Owes `command` the warning that it was passed a flag by a name it has been renamed from. */
export function warnRenamedFlag(command: Command, from: string, to: string): void {
  owe(command, 'flag', `--${from}`, `--${to}`)
}

/** The rename warnings `command` owes, for its result to carry. */
export function owedRenameWarnings(command: Command): readonly string[] {
  return OWED.get(command) ?? []
}

/**
 * Settles what `command` owed once its result has been printed with it: a render that throws
 * first leaves the warnings owed, for {@link writeRenameWarnings}.
 */
export function deliveredRenameWarnings(command: Command): void {
  OWED.delete(command)
}

/** Writes on stderr the rename warnings no printed result delivered. */
export function writeRenameWarnings(command: Command): void {
  for (const warning of owedRenameWarnings(command)) writeStderr(`warning: ${warning}\n`)
  OWED.delete(command)
}
