import { vi } from 'vitest'

type ExecutionSignalReason = 'event' | 'cancelled' | 'reconnected' | 'unavailable'
type ExecutionSignalHandler = (reason: ExecutionSignalReason) => void

const EXECUTION_SIGNAL_PREFIX = 'execution:signal:'

const handlersByChannel = new Map<string, Set<ExecutionSignalHandler>>()

function getExecutionSignalChannel(executionId: string): string {
  return `${EXECUTION_SIGNAL_PREFIX}${executionId}`
}

/**
 * In-process stand-in for the Redis subscriber hub's `subscribe`: registers the handler on the
 * execution's channel and resolves at once (the real hub resolves once SUBSCRIBE is acknowledged);
 * the returned function unsubscribes it.
 */
async function subscribeInProcess(
  executionId: string,
  handler: ExecutionSignalHandler
): Promise<() => void> {
  const channel = getExecutionSignalChannel(executionId)
  let handlers = handlersByChannel.get(channel)
  if (!handlers) {
    handlers = new Set()
    handlersByChannel.set(channel, handlers)
  }
  handlers.add(handler)
  return () => {
    const current = handlersByChannel.get(channel)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) handlersByChannel.delete(channel)
  }
}

/**
 * Controllable mock functions for `@/lib/execution/signal`. `mockSubscribe` is the hub's
 * `subscribe` and defaults to the in-process registry {@link deliverExecutionSignal} publishes to;
 * a test that drives subscription outcomes itself overrides it.
 *
 * @example
 * ```ts
 * executionSignalMockFns.mockSubscribe.mockRejectedValueOnce(new Error('Redis subscriber connection ended'))
 * expect(executionSignalMockFns.mockConnectExecutionSignalHub).toHaveBeenCalledOnce()
 * ```
 */
export const executionSignalMockFns = {
  mockSubscribe: vi.fn(subscribeInProcess),
  mockConnectExecutionSignalHub: vi.fn(),
}

const hub = { subscribe: executionSignalMockFns.mockSubscribe }

/**
 * Delivers a Redis `PUBLISH` to the hub's subscribers the way the real subscriber's `message`
 * listener does: a `cancelled` message dispatches `cancelled`, anything else `event`. A test whose
 * mock Redis client runs the cancellation script calls this with the channel the script publishes to.
 *
 * @example
 * ```ts
 * redis.eval.mockImplementation(async (_script, _keys, _key, _expiry, channel) => {
 *   deliverExecutionSignal(String(channel), 'cancelled')
 * })
 * ```
 */
export function deliverExecutionSignal(channel: string, message: string): void {
  const handlers = handlersByChannel.get(channel)
  if (!handlers) return
  const reason: ExecutionSignalReason = message === 'cancelled' ? 'cancelled' : 'event'
  for (const handler of [...handlers]) handler(reason)
}

/**
 * Static mock module for `@/lib/execution/signal`, registered globally in `apps/sim/vitest.setup.ts`
 * next to the `@/lib/core/config/redis` mock. The real hub dials its own ioredis subscriber from the
 * configured URL rather than going through `getRedisClient`, so without this every unit test that
 * runs the executor would wait out the subscriber readiness budget against a Redis that is not
 * there. Subscriptions are in-process; {@link deliverExecutionSignal} plays the publish side.
 * `lib/execution/signal.test.ts` opts out with `vi.unmock('@/lib/execution/signal')`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/signal', () => executionSignalMock)
 * ```
 */
export const executionSignalMock = {
  LEGACY_EXECUTION_CANCEL_CHANNEL: 'execution:cancel',
  getExecutionSignalChannel,
  getExecutionSignalHub: () => hub,
  connectExecutionSignalHub: executionSignalMockFns.mockConnectExecutionSignalHub,
}
