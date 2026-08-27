export class MicrosoftTeamsOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'MicrosoftTeamsOperationError'
  }
}
