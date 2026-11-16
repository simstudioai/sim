/**
 * The exit status of a wait whose `--wait-timeout` elapsed while the work it watches
 * keeps going: `workflows runs wait`, a synchronous `workflows run` that detached, and a
 * workspace operation wait. The command did what it was asked and printed the record to
 * continue from, so a host that runs the CLI for an agent treats it as a finished call,
 * not a failed one; a script still branches on the non-zero status.
 */
export const STILL_RUNNING_EXIT_CODE = 4

/**
 * `workflows source apply`/`create` refusals a script handles differently: the workflow changed
 * since the directory was read (`409`: read it again and reapply the edit), the workflow is
 * locked (`423`), the source is over the size limits (`413`). Source errors exit 1.
 */
export const SOURCE_STALE_EXIT_CODE = 5
export const SOURCE_LOCKED_EXIT_CODE = 6
export const SOURCE_TOO_LARGE_EXIT_CODE = 7
