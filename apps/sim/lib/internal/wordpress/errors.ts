export class WordPressOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'WordPressOperationError'
  }
}
