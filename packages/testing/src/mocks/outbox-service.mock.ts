import { vi } from 'vitest'

interface MockDeferredOutboxHandlerResult {
  outcome: 'deferred'
  reason: string
  minimumBackoffMs?: number
  consumeAttempt?: false
}

function deferOutboxHandler(
  reason: string,
  minimumBackoffMs?: number,
  consumeAttempt = true
): MockDeferredOutboxHandlerResult {
  return {
    outcome: 'deferred',
    reason,
    ...(minimumBackoffMs !== undefined ? { minimumBackoffMs } : {}),
    ...(consumeAttempt ? {} : { consumeAttempt: false as const }),
  }
}

/**
 * Controllable mock functions for `@/lib/core/outbox/service`.
 *
 * Every enqueue/patch/process/query function is a bare `vi.fn()`. Pure helpers default to the
 * real logic:
 * - `mockDeferOutboxHandler` / `mockContinueOutboxHandler` build the real deferred result
 *   (`continue` = defer without consuming an attempt).
 * - `mockWithOutboxHandlerTimeout` validates the 1..550000 ms window and stamps `timeoutMs` on the
 *   handler, like the real wrapper.
 * - `mockOutboxPayloadHasSourceOperationId` matches `sourceOperationId` or `sourceOperationIds`.
 *
 * `mockOutboxEventHasSourceOperationId` builds a SQL fragment in production; it stays bare
 * (returns `undefined`), matching every local stub.
 *
 * @example
 * ```ts
 * import { outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
 *
 * outboxServiceMockFns.mockEnqueueOutboxEvent.mockResolvedValue('evt-1')
 * ```
 */
export const outboxServiceMockFns = {
  mockDeferOutboxHandler: vi.fn(deferOutboxHandler),
  mockContinueOutboxHandler: vi.fn(
    (reason: string, minimumBackoffMs?: number): MockDeferredOutboxHandlerResult =>
      deferOutboxHandler(reason, minimumBackoffMs, false)
  ),
  mockWithOutboxHandlerTimeout: vi.fn(<T extends object>(handler: T, timeoutMs: number) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 550_000) {
      throw new Error('Outbox handler timeout must be between 1 and 550000 milliseconds')
    }
    return Object.assign(handler, { timeoutMs })
  }),
  mockEnqueueOutboxEvent: vi.fn(),
  mockEnqueueOutboxEvents: vi.fn(),
  mockEnqueueOrReschedulePendingOutboxEvent: vi.fn(),
  mockPatchOutboxEventPayload: vi.fn(),
  mockAddOutboxEventSourceOperationId: vi.fn(),
  mockOutboxEventHasSourceOperationId: vi.fn(),
  mockOutboxPayloadHasSourceOperationId: vi.fn((payload: unknown, operationId: string): boolean => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const record = payload as Record<string, unknown>
    return (
      record.sourceOperationId === operationId ||
      (Array.isArray(record.sourceOperationIds) && record.sourceOperationIds.includes(operationId))
    )
  }),
  mockFindDeadLetteredEvents: vi.fn(),
  mockHasInflightOutboxEvent: vi.fn(),
  mockProcessOutboxEvents: vi.fn(),
  mockProcessOutboxEventById: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/outbox/service`. Covers every runtime export;
 * `MAX_BULK_ENQUEUE_EVENTS` carries the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)
 * ```
 */
export const outboxServiceMock = {
  MAX_BULK_ENQUEUE_EVENTS: 1_000,
  deferOutboxHandler: outboxServiceMockFns.mockDeferOutboxHandler,
  continueOutboxHandler: outboxServiceMockFns.mockContinueOutboxHandler,
  withOutboxHandlerTimeout: outboxServiceMockFns.mockWithOutboxHandlerTimeout,
  enqueueOutboxEvent: outboxServiceMockFns.mockEnqueueOutboxEvent,
  enqueueOutboxEvents: outboxServiceMockFns.mockEnqueueOutboxEvents,
  enqueueOrReschedulePendingOutboxEvent:
    outboxServiceMockFns.mockEnqueueOrReschedulePendingOutboxEvent,
  patchOutboxEventPayload: outboxServiceMockFns.mockPatchOutboxEventPayload,
  addOutboxEventSourceOperationId: outboxServiceMockFns.mockAddOutboxEventSourceOperationId,
  outboxEventHasSourceOperationId: outboxServiceMockFns.mockOutboxEventHasSourceOperationId,
  outboxPayloadHasSourceOperationId: outboxServiceMockFns.mockOutboxPayloadHasSourceOperationId,
  findDeadLetteredEvents: outboxServiceMockFns.mockFindDeadLetteredEvents,
  hasInflightOutboxEvent: outboxServiceMockFns.mockHasInflightOutboxEvent,
  processOutboxEvents: outboxServiceMockFns.mockProcessOutboxEvents,
  processOutboxEventById: outboxServiceMockFns.mockProcessOutboxEventById,
}
