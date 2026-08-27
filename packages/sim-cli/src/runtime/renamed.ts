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

/**
 * Announces that `--workspace` had nothing to act on.
 *
 * `-w` is a root-program global, so commander accepts it on every command,
 * while it is only ever substituted into an operation that declares a
 * `workspaceId`. On the rest — every workflow-, run- and server-addressed
 * route, whose id is global and whose scope the server reads off the record
 * itself — the value was parsed and dropped, so three different `-w` values
 * produced byte-identical requests and read as a scoping bug.
 *
 * Said rather than refused: 39 of the API's operations declare no
 * `workspaceId`, and a wrapper that appends `-w` to every invocation is
 * exactly the shape that would break. Warning removes the silence, which is
 * the part that misled, without failing a call that was already correct.
 */
export function warnUnusedWorkspace(command: string): void {
  const key = `workspace:${command}`
  if (warned.has(key)) return
  warned.add(key)
  process.stderr.write(
    `warning: --workspace does not apply to "${command}"; the id you passed already identifies the workspace, and the flag was ignored.\n`
  )
}

/** Test seam: renames warn once per process, and each test needs a clean slate. */
export function resetRenameWarnings(): void {
  warned.clear()
}
