export class UptimeRobotOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'UptimeRobotOperationError'
  }
}
