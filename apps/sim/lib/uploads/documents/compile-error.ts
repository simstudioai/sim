/** Classifies a failed document build or a compiled artifact that is still pending. */
export class DocCompileUserError extends Error {
  /** True when the artifact is still compiling and a retry may succeed. */
  readonly pending: boolean

  constructor(message: string, options?: { pending?: boolean }) {
    super(message)
    this.name = 'DocCompileUserError'
    this.pending = options?.pending ?? false
  }
}
