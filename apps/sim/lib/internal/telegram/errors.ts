export class TelegramOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TelegramOperationError'
  }
}
