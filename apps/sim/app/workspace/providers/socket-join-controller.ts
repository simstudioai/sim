export const SOCKET_JOIN_RETRY_BASE_DELAY_MS = 1000
export const SOCKET_JOIN_RETRY_MAX_DELAY_MS = 10000

export type SocketJoinCommand =
  | { type: 'cancel-retry' }
  | { type: 'join'; workflowId: string }
  | { type: 'leave' }
  | {
      type: 'schedule-retry'
      workflowId: string
      attempt: number
      delayMs: number
    }

interface SocketJoinSuccessResult {
  apply: boolean
  commands: SocketJoinCommand[]
  ignored: boolean
  workflowId: string
}

interface SocketJoinErrorResult {
  apply: boolean
  commands: SocketJoinCommand[]
  ignored: boolean
  retryScheduled: boolean
  workflowId: string | null
}

interface SocketJoinDeleteResult {
  commands: SocketJoinCommand[]
  shouldClearCurrent: boolean
}

/**
 * Coordinates desired workflow room membership with async socket join results.
 */
export class SocketJoinController {
  private desiredWorkflowId: string | null = null
  private joinedWorkflowId: string | null = null
  private pendingJoinWorkflowId: string | null = null
  private blockedWorkflowId: string | null = null
  private retryWorkflowId: string | null = null
  private retryAttempt = 0
  private isConnected = false

  getJoinedWorkflowId(): string | null {
    return this.joinedWorkflowId
  }

  setConnected(connected: boolean): SocketJoinCommand[] {
    this.isConnected = connected
    if (!connected) {
      this.pendingJoinWorkflowId = null
      this.joinedWorkflowId = null
      return this.clearRetryCommands()
    }

    return this.flush()
  }

  requestWorkflow(workflowId: string | null): SocketJoinCommand[] {
    const commands = this.takeRetryResetCommands(workflowId)
    this.desiredWorkflowId = workflowId

    if (workflowId !== this.blockedWorkflowId) {
      this.blockedWorkflowId = null
    }

    return [...commands, ...this.flush()]
  }

  forceRejoinWorkflow(workflowId: string | null): SocketJoinCommand[] {
    const commands = this.requestWorkflow(workflowId)
    const alreadyChangingRooms = commands.some(
      (command) => command.type === 'join' || command.type === 'leave'
    )

    if (
      alreadyChangingRooms ||
      !this.isConnected ||
      !this.desiredWorkflowId ||
      this.pendingJoinWorkflowId === this.desiredWorkflowId ||
      this.blockedWorkflowId === this.desiredWorkflowId
    ) {
      return commands
    }

    this.joinedWorkflowId = null

    return [...commands, ...this.flush()]
  }

  handleWorkflowDeleted(workflowId: string): SocketJoinDeleteResult {
    const commands = this.takeRetryResetCommands(
      this.retryWorkflowId === workflowId ? null : this.retryWorkflowId
    )

    if (this.desiredWorkflowId === workflowId) {
      this.blockedWorkflowId = workflowId
    }

    if (this.pendingJoinWorkflowId === workflowId) {
      this.pendingJoinWorkflowId = null
    }

    const shouldClearCurrent = this.joinedWorkflowId === workflowId
    if (shouldClearCurrent) {
      this.joinedWorkflowId = null
    }

    return {
      commands: [...commands, ...this.flush()],
      shouldClearCurrent,
    }
  }

  handleJoinSuccess(workflowId: string): SocketJoinSuccessResult {
    const commands = this.clearRetryCommands(workflowId)
    this.pendingJoinWorkflowId = null
    this.joinedWorkflowId = workflowId

    const apply = this.desiredWorkflowId === workflowId && this.blockedWorkflowId !== workflowId

    return {
      apply,
      commands: [...commands, ...this.flush()],
      ignored: !apply,
      workflowId,
    }
  }

  handleJoinError({
    workflowId,
    retryable,
  }: {
    workflowId?: string | null
    retryable?: boolean
  }): SocketJoinErrorResult {
    const resolvedWorkflowId = workflowId ?? this.pendingJoinWorkflowId

    if (resolvedWorkflowId && this.pendingJoinWorkflowId === resolvedWorkflowId) {
      this.pendingJoinWorkflowId = null
      if (this.joinedWorkflowId === resolvedWorkflowId) {
        this.joinedWorkflowId = null
      }
    }

    const isCurrentDesired =
      Boolean(resolvedWorkflowId) &&
      this.desiredWorkflowId === resolvedWorkflowId &&
      this.blockedWorkflowId !== resolvedWorkflowId

    const baseCommands =
      resolvedWorkflowId !== null
        ? this.takeRetryResetCommands(resolvedWorkflowId)
        : this.clearRetryCommands()

    if (!isCurrentDesired) {
      return {
        apply: false,
        commands: [...baseCommands, ...this.flush()],
        ignored: true,
        retryScheduled: false,
        workflowId: resolvedWorkflowId,
      }
    }

    if (retryable && resolvedWorkflowId) {
      const commands = this.scheduleRetry(resolvedWorkflowId)

      return {
        apply: false,
        commands: [...baseCommands, ...commands],
        ignored: false,
        retryScheduled: true,
        workflowId: resolvedWorkflowId,
      }
    }

    const leaveCommands = this.blockWorkflow(resolvedWorkflowId)

    return {
      apply: true,
      commands: [...this.clearRetryCommands(), ...leaveCommands, ...this.flush()],
      ignored: false,
      retryScheduled: false,
      workflowId: resolvedWorkflowId,
    }
  }

  retryJoin(workflowId: string): SocketJoinCommand[] {
    if (
      this.retryWorkflowId !== workflowId ||
      this.desiredWorkflowId !== workflowId ||
      this.blockedWorkflowId === workflowId
    ) {
      return []
    }

    return this.flush()
  }

  private flush(): SocketJoinCommand[] {
    if (!this.isConnected || this.pendingJoinWorkflowId) {
      return []
    }

    if (!this.desiredWorkflowId) {
      if (!this.joinedWorkflowId) {
        return []
      }

      this.joinedWorkflowId = null
      return [{ type: 'leave' }]
    }

    if (this.blockedWorkflowId === this.desiredWorkflowId) {
      return []
    }

    if (this.joinedWorkflowId === this.desiredWorkflowId) {
      return []
    }

    this.pendingJoinWorkflowId = this.desiredWorkflowId

    return [{ type: 'join', workflowId: this.desiredWorkflowId }]
  }

  private scheduleRetry(workflowId: string): SocketJoinCommand[] {
    const nextAttempt = this.retryWorkflowId === workflowId ? this.retryAttempt + 1 : 1
    const delayMs = Math.min(
      SOCKET_JOIN_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, nextAttempt - 1),
      SOCKET_JOIN_RETRY_MAX_DELAY_MS
    )

    this.retryWorkflowId = workflowId
    this.retryAttempt = nextAttempt

    return [
      {
        type: 'schedule-retry',
        workflowId,
        attempt: nextAttempt,
        delayMs,
      },
    ]
  }

  private takeRetryResetCommands(nextWorkflowId?: string | null): SocketJoinCommand[] {
    const shouldClearRetry =
      this.retryWorkflowId !== null &&
      (nextWorkflowId === undefined || this.retryWorkflowId !== nextWorkflowId)

    if (!shouldClearRetry) {
      return []
    }

    this.retryWorkflowId = null
    this.retryAttempt = 0

    return [{ type: 'cancel-retry' }]
  }

  private clearRetryCommands(workflowId?: string): SocketJoinCommand[] {
    const shouldClear =
      this.retryWorkflowId !== null &&
      (workflowId === undefined || this.retryWorkflowId === workflowId)

    if (!shouldClear) {
      return []
    }

    this.retryWorkflowId = null
    this.retryAttempt = 0

    return [{ type: 'cancel-retry' }]
  }

  private blockWorkflow(workflowId: string | null): SocketJoinCommand[] {
    if (workflowId) {
      this.blockedWorkflowId = workflowId
    }

    if (!this.joinedWorkflowId) {
      return []
    }

    this.joinedWorkflowId = null

    return [{ type: 'leave' }]
  }
}
