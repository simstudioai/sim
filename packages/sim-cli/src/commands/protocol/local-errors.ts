/**
 * Refusals a source command raises itself, with no request behind them. They render and exit
 * through the same path as an API error (`status` 0: no server answered), so a script sees the
 * same message, code and exit status, while the code that raises one says it is local.
 */

import { SimApiError } from '../../http/client'

/** What a local refusal carries beside its message: a machine-readable code and the exit status. */
interface LocalErrorOptions {
  /** The code a script branches on (`SOURCE_SYMLINK`, `SOURCE_DIR_BUSY`); none by default. */
  code?: string
  /** The process exit status; 1 by default. */
  exitCode?: number
}

/**
 * A refusal the CLI raised itself. Its `status` 0 and possibly null `code` read like a request
 * that got no answer, so a check for an unreachable server or a lost answer excludes this class.
 */
export abstract class LocalRefusal extends SimApiError {}

/**
 * A source directory, its records or a file it would send or write refused by the CLI: a missing
 * or unreadable file, a symbolic link, another kind of directory, a busy or unwritable directory,
 * or a server answer naming a path the CLI never writes.
 */
export class SourceDirError extends LocalRefusal {
  constructor(message: string, options: LocalErrorOptions = {}) {
    super(message, 0, options.code ?? null, undefined, options.exitCode ?? 1)
    this.name = 'SourceDirError'
  }
}

/**
 * Flags or arguments a source command cannot act on: an unknown kind or path filter, flags that
 * contradict each other, or a missing `--workspace`. Refused before any request is sent.
 */
export class CliUsageError extends LocalRefusal {
  constructor(message: string, options: Pick<LocalErrorOptions, 'code'> = {}) {
    super(message, 0, options.code ?? null)
    this.name = 'CliUsageError'
  }
}
