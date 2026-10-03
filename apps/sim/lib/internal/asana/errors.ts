export type AsanaErrorBody = Record<string, unknown> & { error: string }

export class AsanaOperationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: AsanaErrorBody
  ) {
    super(message)
    this.name = 'AsanaOperationError'
  }
}
