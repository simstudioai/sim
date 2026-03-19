import { createLogger } from '@sim/logger'
import type { McpToolResult } from '@/lib/mcp/types'
import type { McpExecutionContext, McpMiddleware, McpMiddlewareNext } from './types'

// Configure standard cache size limit
const MAX_SERVER_STATES = 1000

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN'

export interface CircuitBreakerConfig {
  /** Number of failures before tripping to OPEN */
  failureThreshold: number
  /** How long to wait in OPEN before transitioning to HALF-OPEN (ms) */
  resetTimeoutMs: number
}

interface ServerState {
  state: CircuitState
  failures: number
  nextAttemptMs: number
  isHalfOpenProbing: boolean
}

const logger = createLogger('mcp:resilience:circuit-breaker')

export class CircuitBreakerMiddleware implements McpMiddleware {
  // Use a Map to maintain insertion order for standard LRU-like eviction if necessary.
  // We constrain it to prevent memory leaks if thousands of ephemeral servers connect.
  private registry = new Map<string, ServerState>()
  private config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeoutMs: config.resetTimeoutMs ?? 30000,
    }
  }

  private getState(serverId: string): ServerState {
    let state = this.registry.get(serverId)
    if (!state) {
      state = {
        state: 'CLOSED',
        failures: 0,
        nextAttemptMs: 0,
        isHalfOpenProbing: false,
      }
      this.registry.set(serverId, state)
      this.evictIfNecessary()
    }
    return state
  }

  private evictIfNecessary() {
    if (this.registry.size > MAX_SERVER_STATES) {
      // Evict the oldest entry (first inserted)
      const firstKey = this.registry.keys().next().value
      if (firstKey) {
        this.registry.delete(firstKey)
      }
    }
  }

  async execute(context: McpExecutionContext, next: McpMiddlewareNext): Promise<McpToolResult> {
    const { serverId, toolCall } = context
    const serverState = this.getState(serverId)

    // 1. Check current state and evaluate timeouts
    if (serverState.state === 'OPEN') {
      if (Date.now() > serverState.nextAttemptMs) {
        // Time to try again, enter HALF-OPEN
        logger.info(`Circuit breaker entering HALF-OPEN for server ${serverId}`)
        serverState.state = 'HALF-OPEN'
        serverState.isHalfOpenProbing = false
      } else {
        // Fast-fail
        throw new Error(
          `Circuit breaker is OPEN for server ${serverId}. Fast-failing request to ${toolCall.name}.`
        )
      }
    }

    if (serverState.state === 'HALF-OPEN') {
      if (serverState.isHalfOpenProbing) {
        // Another request is already probing. Fast-fail concurrent requests.
        throw new Error(
          `Circuit breaker is HALF-OPEN for server ${serverId}. A probe request is currently executing. Fast-failing concurrent request to ${toolCall.name}.`
        )
      }
      // We are the chosen ones. Lock it down.
      serverState.isHalfOpenProbing = true
    }

    try {
      // 2. Invoke the next layer
      const result = await next(context)

      // 3. Handle result parsing (isError = true counts as failure for us)
      if (result.isError) {
        this.recordFailure(serverId, serverState)
      } else {
        this.recordSuccess(serverId, serverState)
      }

      return result
    } catch (error) {
      // Note: we record failure on ANY exception
      this.recordFailure(serverId, serverState)
      throw error // Re-throw to caller
    }
  }

  private recordSuccess(serverId: string, state: ServerState) {
    if (state.state !== 'CLOSED') {
      logger.info(`Circuit breaker reset to CLOSED for server ${serverId}`)
    }
    state.state = 'CLOSED'
    state.failures = 0
    state.isHalfOpenProbing = false
  }

  private recordFailure(serverId: string, state: ServerState) {
    if (state.state === 'HALF-OPEN') {
      // The probe failed! Trip immediately back to OPEN.
      logger.warn(`Circuit breaker probe failed. Tripping back to OPEN for server ${serverId}`)
      this.tripToOpen(state)
    } else if (state.state === 'CLOSED') {
      state.failures++
      if (state.failures >= this.config.failureThreshold) {
        logger.error(
          `Circuit breaker failure threshold reached (${state.failures}/${this.config.failureThreshold}). Tripping to OPEN for server ${serverId}`
        )
        this.tripToOpen(state)
      }
    }
  }

  private tripToOpen(state: ServerState) {
    state.state = 'OPEN'
    state.isHalfOpenProbing = false
    state.nextAttemptMs = Date.now() + this.config.resetTimeoutMs
  }
}
