/**
 * The exit status of a wait whose `--wait-timeout` elapsed while the work it watches
 * keeps going: `workflows runs wait`, a synchronous `workflows run` that detached, and a
 * workspace operation wait. The command did what it was asked and printed the record to
 * continue from, so a host that runs the CLI for an agent treats it as a finished call,
 * not a failed one; a script still branches on the non-zero status.
 */
export const STILL_RUNNING_EXIT_CODE = 4

/**
 * A `workflows source apply` whose workflow changed since the directory was read: `409` with
 * `SOURCE_STALE`, or `E_APPLY_STALE` on a dry run. Read it again and reapply the edit. Source
 * errors and any other `409` (such as `SOURCE_NAME_TAKEN`) exit 1.
 */
export const SOURCE_STALE_EXIT_CODE = 5
/** A `workflows source apply`/`create` refused because the workflow or its folder is locked. */
export const SOURCE_LOCKED_EXIT_CODE = 6
/**
 * A workflow source over the size limits (`413`): refused by `workflows source apply`/`create`, or
 * too large for `workflows source get` to print.
 */
export const SOURCE_TOO_LARGE_EXIT_CODE = 7
