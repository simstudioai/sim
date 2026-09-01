/** Error used when a cooperative execution timeout must fail its backing job. */
export class ExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}
