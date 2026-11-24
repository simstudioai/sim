import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/request/worker/fetch`. `mockFetchWorker` is bare:
 * set a `Response` per test.
 *
 * @example
 * ```ts
 * import { mothershipWorkerFetchMockFns } from '@sim/testing/mocks/mothership-worker-fetch.mock'
 *
 * mothershipWorkerFetchMockFns.mockFetchWorker.mockResolvedValue(new Response('{}', { status: 200 }))
 * ```
 */
export const mothershipWorkerFetchMockFns = {
  mockFetchWorker: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/request/worker/fetch`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/request/worker/fetch', () => mothershipWorkerFetchMock)
 * ```
 */
export const mothershipWorkerFetchMock = {
  fetchWorker: mothershipWorkerFetchMockFns.mockFetchWorker,
}
