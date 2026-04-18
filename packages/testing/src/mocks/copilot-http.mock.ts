import { vi } from 'vitest'

/**
 * Frozen mirror of the `NotificationStatus` const from
 * `@/lib/copilot/request/http`. Matches the real values so route code using
 * e.g. `NotificationStatus.success` keeps resolving under mock.
 */
const NotificationStatusMock = {
  pending: 'pending',
  background: 'background',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
} as const

/**
 * Controllable mock functions for `@/lib/copilot/request/http`.
 * Response helpers default to returning minimal Response-like objects so
 * handler tests can assert `res.status` and `await res.json()`.
 * `createRequestTracker` returns a stable tracker with `requestId`,
 * `startTime`, and a `getDuration()` that always returns `0`.
 *
 * @example
 * ```ts
 * import { copilotHttpMockFns } from '@sim/testing'
 *
 * copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
 *   userId: 'user-1',
 *   isAuthenticated: true,
 * })
 * ```
 */
export const copilotHttpMockFns = {
  mockCreateUnauthorizedResponse: vi.fn(() => ({
    status: 401,
    ok: false,
    json: async () => ({ error: 'Unauthorized' }),
  })),
  mockCreateBadRequestResponse: vi.fn((message: string) => ({
    status: 400,
    ok: false,
    json: async () => ({ error: message }),
  })),
  mockCreateNotFoundResponse: vi.fn((message: string) => ({
    status: 404,
    ok: false,
    json: async () => ({ error: message }),
  })),
  mockCreateInternalServerErrorResponse: vi.fn((message: string) => ({
    status: 500,
    ok: false,
    json: async () => ({ error: message }),
  })),
  mockCreateRequestId: vi.fn(() => 'test-request-id'),
  mockCreateShortRequestId: vi.fn(() => 'test-req'),
  mockCreateRequestTracker: vi.fn(() => ({
    requestId: 'test-req',
    startTime: 0,
    getDuration: () => 0,
  })),
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockCheckInternalApiKey: vi.fn(),
}

/**
 * Static mock module for `@/lib/copilot/request/http`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)
 * ```
 */
export const copilotHttpMock = {
  NotificationStatus: NotificationStatusMock,
  createUnauthorizedResponse: copilotHttpMockFns.mockCreateUnauthorizedResponse,
  createBadRequestResponse: copilotHttpMockFns.mockCreateBadRequestResponse,
  createNotFoundResponse: copilotHttpMockFns.mockCreateNotFoundResponse,
  createInternalServerErrorResponse: copilotHttpMockFns.mockCreateInternalServerErrorResponse,
  createRequestId: copilotHttpMockFns.mockCreateRequestId,
  createShortRequestId: copilotHttpMockFns.mockCreateShortRequestId,
  createRequestTracker: copilotHttpMockFns.mockCreateRequestTracker,
  authenticateCopilotRequestSessionOnly:
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly,
  checkInternalApiKey: copilotHttpMockFns.mockCheckInternalApiKey,
}
