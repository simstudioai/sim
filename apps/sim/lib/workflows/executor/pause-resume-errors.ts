export class PausedExecutionNotFoundError extends Error {
  constructor(message = 'Paused execution not found or already resumed') {
    super(message)
    this.name = 'PausedExecutionNotFoundError'
  }
}

export class PauseSnapshotNotReadyError extends Error {
  constructor(message = 'Snapshot not ready; execution still finalizing pause') {
    super(message)
    this.name = 'PauseSnapshotNotReadyError'
  }
}

export class PausePointNotFoundError extends Error {
  constructor(message = 'Pause point not found for execution') {
    super(message)
    this.name = 'PausePointNotFoundError'
  }
}

export class PausePointNotPausedError extends Error {
  constructor(message = 'Pause point already resumed or in progress') {
    super(message)
    this.name = 'PausePointNotPausedError'
  }
}
