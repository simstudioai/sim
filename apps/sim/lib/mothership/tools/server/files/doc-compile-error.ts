/**
 * Signals that a generated document's artifact could not be served from the
 * generation source.
 *
 * Two causes share the class. `pending` marks the transient one — the artifact
 * is still compiling, so the caller should retry. Everything else is a permanent
 * generation failure: the script raised, produced no output, or targeted a
 * format with no fallback. Retrying those never succeeds, so a caller that
 * reports both as "still being generated" tells the user to wait forever.
 *
 * Lives in its own leaf module — with no imports — so that callers which only
 * need to *recognize* this error do not pull in `doc-compile`, which reaches
 * `app/api/**` and therefore `next/server`. Application modules must not take
 * that edge.
 */
export class DocCompileUserError extends Error {
  /** True when the artifact is still compiling and a retry may succeed. */
  readonly pending: boolean

  constructor(message: string, options?: { pending?: boolean }) {
    super(message)
    this.name = 'DocCompileUserError'
    this.pending = options?.pending ?? false
  }
}
