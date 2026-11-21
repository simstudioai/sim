/**
 * The exit status of a wait whose `--wait-timeout` elapsed while the work it watches
 * keeps going: `workflows runs wait`, a synchronous `workflows run` that detached, and a
 * workspace operation wait. The command did what it was asked and printed the record to
 * continue from, so a host that runs the CLI for an agent treats it as a finished call,
 * not a failed one; a script still branches on the non-zero status.
 */
export const STILL_RUNNING_EXIT_CODE = 4

/**
 * A `workflows source apply` or `workspaces source apply` whose workflow or resources changed
 * since the directory was read: `409` with `SOURCE_STALE`, or `E_APPLY_STALE` on a dry run. Read
 * it again and reapply the edit. Source errors and any other `409` (such as `SOURCE_NAME_TAKEN`)
 * exit 1.
 */
export const SOURCE_STALE_EXIT_CODE = 5
/**
 * A `workflows source apply`/`create` or `workspaces source apply` refused because a workflow or
 * its folder is locked (`E_APPLY_LOCKED`).
 */
export const SOURCE_LOCKED_EXIT_CODE = 6
/**
 * Source over the size limits (`413`, or a size finding on a dry run): refused by `workflows
 * source apply`/`create` or `workspaces source apply`, or too large for a `workflows source` or
 * `workspaces source` get, status or diff to read.
 */
export const SOURCE_TOO_LARGE_EXIT_CODE = 7

/**
 * `workspaces source apply` stopped part-way on a server failure (`E_APPLY_FAILED`): the changes
 * before the failed one were written and saved back into the directory, the rest were not
 * attempted. Applying again continues. A write refused part-way exits as that refusal instead.
 */
export const SOURCE_PARTIAL_EXIT_CODE = 8

/**
 * A request the server still answered `429` (rate limited) after the CLI resent it as often as it
 * will, or a write it does not resend. Nothing was done by the refused request: wait a minute and
 * run the command again.
 */
export const RATE_LIMITED_EXIT_CODE = 9

/**
 * Busy, retry. A `workspaces source apply` refused because another apply is writing the workspace
 * (`409` with `SOURCE_BUSY`), or a source command refused because another one holds the same
 * directory (`SOURCE_DIR_BUSY`): nothing of this one was read or written. Wait for the
 * other to finish, then run it again; a write the other apply made to a resource this directory
 * changes then exits 5.
 */
export const SOURCE_BUSY_EXIT_CODE = 10

/**
 * A `workflows source status` or `workspaces source status` whose directory holds changes no apply
 * has saved, while the server (when it answered) changed nothing the directory read: applying
 * writes them.
 */
export const SOURCE_LOCAL_CHANGES_EXIT_CODE = 11

/**
 * A `workflows source status` or `workspaces source status` that found the server changed since
 * the directory was read: drift (a resource edited, added or deleted on the server that the
 * directory leaves alone) or a conflict (one also changed locally, so applying it is refused as
 * stale). Local changes may exist beside it.
 */
export const SOURCE_DRIFT_EXIT_CODE = 12

/**
 * No usable login: the profile has no credential (`AUTH_REQUIRED`, "Not logged in"), its OAuth
 * login expired and cannot be refreshed, or the server refused the credential (`401`). Nothing
 * was sent or done: run `sim login`, then the same command again. Apart from exit 1 (the source
 * has errors, or another failure), so a script can tell a login to fix from a source to fix.
 */
export const AUTH_REQUIRED_EXIT_CODE = 13

/**
 * A `workflows source apply`/`create` or `workspaces source apply` run without `--yes` where no
 * terminal can ask: it printed the plan a dry run found, with no errors, and wrote nothing. Run
 * the same command with `--yes` to apply that plan.
 */
export const SOURCE_PLANNED_EXIT_CODE = 14

/**
 * A `workspaces source apply` (or a promotion with `--to`) that wrote part of its plan and held the
 * rest back: a change that uses a declared secret the workspace has no value for, or a declared
 * credential key nothing binds to. What was written is saved; set the secret or connect the
 * credential and apply again. Apart from exit 1 (nothing written), so a script can tell a clean
 * refusal from a target left half-applied.
 */
export const SOURCE_HELD_EXIT_CODE = 15

/** The error code of an {@link AUTH_REQUIRED_EXIT_CODE} refusal the CLI raises itself. */
export const AUTH_REQUIRED_CODE = 'AUTH_REQUIRED'
