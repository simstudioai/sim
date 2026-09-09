/** A durable tool identity must never be reused by a different run. */
export class AsyncToolCallOwnershipError extends Error {
  constructor() {
    super('Async tool call belongs to another run')
    this.name = 'AsyncToolCallOwnershipError'
  }
}
