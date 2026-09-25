/** Direct execution was refused before dispatch because its payer or actor exceeded a limit. */
export class ToolExecutionUsageLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolExecutionUsageLimitError'
  }
}
