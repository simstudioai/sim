export class TwilioVoiceOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TwilioVoiceOperationError'
  }
}
