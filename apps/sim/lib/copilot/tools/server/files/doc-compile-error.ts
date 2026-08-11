/**
 * Signals that a generated document's artifact is still compiling, so the caller
 * should retry rather than treat the read as a fault.
 *
 * Lives in its own leaf module — with no imports — so that callers which only
 * need to *recognize* this error do not pull in `doc-compile`, which reaches
 * `app/api/**` and therefore `next/server`. Application modules must not take
 * that edge.
 */
export class DocCompileUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocCompileUserError'
  }
}
