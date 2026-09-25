import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/request/go/fetch`. `mockFetchGo` is bare:
 * set a `Response` per test.
 *
 * @example
 * ```ts
 * import { mothershipGoFetchMockFns } from '@sim/testing/mocks/mothership-go-fetch.mock'
 *
 * mothershipGoFetchMockFns.mockFetchGo.mockResolvedValue(new Response('{}', { status: 200 }))
 * ```
 */
export const mothershipGoFetchMockFns = {
  mockFetchGo: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/request/go/fetch`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
 * ```
 */
export const mothershipGoFetchMock = {
  fetchGo: mothershipGoFetchMockFns.mockFetchGo,
}
