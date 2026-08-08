export class ChatRunProgressUnavailableError extends Error {
  constructor() {
    super('Chat run progress is temporarily unavailable')
    this.name = 'ChatRunProgressUnavailableError'
  }
}
