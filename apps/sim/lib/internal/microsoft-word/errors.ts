/** An invalid Microsoft Word operation input. */
export class MicrosoftWordInputError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'MicrosoftWordInputError'
  }
}
