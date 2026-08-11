/** Raised when a row disappears before an operation can mutate it. */
export class TableRowNotFoundError extends Error {
  constructor() {
    super('Row not found')
    this.name = 'TableRowNotFoundError'
  }
}
