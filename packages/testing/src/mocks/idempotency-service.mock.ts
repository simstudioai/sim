import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/idempotency/service`.
 *
 * Every `IdempotencyService` instance and the exported singletons (`webhookIdempotency`,
 * `pollingIdempotency`, `chatSendIdempotency`) share these functions. `executeWithIdempotency`
 * runs the operation once, as a first claim would; `executeOrSkipInProgress` resolves with its
 * result. `atomicallyClaim` is a bare `vi.fn()`; `release` resolves `undefined`. The static
 * `IdempotencyService.createWebhookIdempotencyKey` returns `<webhookId>:idempotency-key`.
 * `mockConstructor` records each `new IdempotencyService(config)`. Defaults are
 * `vi.fn(impl)`, so `mockReset()` restores them.
 *
 * @example
 * ```ts
 * import { idempotencyServiceMockFns } from '@sim/testing/mocks/idempotency-service.mock'
 *
 * idempotencyServiceMockFns.mockAtomicallyClaim.mockResolvedValue({ claimed: true })
 * ```
 */
export const idempotencyServiceMockFns = {
  mockConstructor: vi.fn((_config?: unknown): void => {}),
  mockCreateWebhookIdempotencyKey: vi.fn(
    (webhookId: string, ..._args: unknown[]): string => `${webhookId}:idempotency-key`
  ),
  mockAtomicallyClaim: vi.fn(),
  mockRelease: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockExecuteWithIdempotency: vi.fn(
    async (_provider: string, _identifier: string, operation: () => Promise<unknown>) => operation()
  ),
  mockExecuteOrSkipInProgress: vi.fn(
    async (_provider: string, _identifier: string, operation: () => Promise<unknown>) => ({
      outcome: 'resolved' as const,
      result: await operation(),
    })
  ),
}

const idempotencyMethods = {
  atomicallyClaim: (...args: unknown[]) => idempotencyServiceMockFns.mockAtomicallyClaim(...args),
  release: (...args: unknown[]) => idempotencyServiceMockFns.mockRelease(...args),
  executeWithIdempotency: (
    provider: string,
    identifier: string,
    operation: () => Promise<unknown>
  ) => idempotencyServiceMockFns.mockExecuteWithIdempotency(provider, identifier, operation),
  executeOrSkipInProgress: (
    provider: string,
    identifier: string,
    operation: () => Promise<unknown>
  ) => idempotencyServiceMockFns.mockExecuteOrSkipInProgress(provider, identifier, operation),
}

class IdempotencyService {
  static createWebhookIdempotencyKey = (webhookId: string, ...args: unknown[]) =>
    idempotencyServiceMockFns.mockCreateWebhookIdempotencyKey(webhookId, ...args)

  constructor(config?: unknown) {
    idempotencyServiceMockFns.mockConstructor(config)
  }

  atomicallyClaim = idempotencyMethods.atomicallyClaim
  release = idempotencyMethods.release
  executeWithIdempotency = idempotencyMethods.executeWithIdempotency
  executeOrSkipInProgress = idempotencyMethods.executeOrSkipInProgress
}

/**
 * Static mock module for `@/lib/core/idempotency/service`. Covers every runtime export;
 * `WEBHOOK_IN_PROGRESS_LEASE_SECONDS` carries the real value (2 hours).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/idempotency/service', () => idempotencyServiceMock)
 * ```
 */
export const idempotencyServiceMock = {
  WEBHOOK_IN_PROGRESS_LEASE_SECONDS: 60 * 60 * 2,
  IdempotencyService,
  webhookIdempotency: idempotencyMethods,
  pollingIdempotency: idempotencyMethods,
  chatSendIdempotency: idempotencyMethods,
}
