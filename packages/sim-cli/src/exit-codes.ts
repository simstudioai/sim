/**
 * The exit status of a wait whose `--wait-timeout` elapsed while the work it watches
 * keeps going: `workflows runs wait`, a synchronous `workflows run` that detached, and a
 * workspace operation wait. The command did what it was asked and printed the record to
 * continue from, so a host that runs the CLI for an agent treats it as a finished call,
 * not a failed one; a script still branches on the non-zero status.
 */
export const STILL_RUNNING_EXIT_CODE = 4
