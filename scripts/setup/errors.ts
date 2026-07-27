/** A setup failure that carries actionable next steps for the failure screen. */
export class SetupError extends Error {
  readonly hints: string[]

  constructor(message: string, hints: string[] = []) {
    super(message)
    this.name = 'SetupError'
    this.hints = hints
  }
}
