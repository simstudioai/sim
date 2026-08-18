/**
 * Support for spellings the CLI has moved on from.
 *
 * A rename is not an alias. {@link CommandSpec.aliases} are ergonomic shorthands
 * — `ls`, `mv` — that the CLI wants people to use, so they appear in help. A
 * renamed spelling is kept only so a script written against the old name keeps
 * working: it stays out of help and out of the generated docs, and says once,
 * on stderr, what to write instead.
 *
 * Warnings go to stderr rather than stdout because the old name is most likely
 * to survive inside exactly the kind of script that pipes stdout into `jq`, and
 * a deprecation notice in the middle of a JSON document is a worse bug than the
 * one it reports.
 */

/** Reported spellings, so a loop over many rows warns once rather than per row. */
const warned = new Set<string>()

function warn(kind: string, from: string, to: string): void {
  const key = `${kind}:${from}`
  if (warned.has(key)) return
  warned.add(key)
  process.stderr.write(
    `warning: ${kind} "${from}" has been renamed to "${to}". The old name still works.\n`
  )
}

/** Announces a command path that has been renamed, naming its current spelling. */
export function warnRenamedCommand(from: string, to: string): void {
  warn('command', `sim ${from}`, `sim ${to}`)
}

/** Announces a flag that has been renamed, naming its current spelling. */
export function warnRenamedFlag(from: string, to: string): void {
  warn('flag', `--${from}`, `--${to}`)
}

/** Test seam: renames warn once per process, and each test needs a clean slate. */
export function resetRenameWarnings(): void {
  warned.clear()
}
