/** A durable tool identity must keep its original owner and invocation. */
export class AsyncToolCallOwnershipError extends Error {
  constructor(message = 'Async tool call belongs to another run') {
    super(message)
    this.name = 'AsyncToolCallOwnershipError'
  }
}
