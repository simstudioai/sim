import { vi } from 'vitest'

const mockRelease = vi.fn((): void => {})

/**
 * Controllable mock functions for `@/lib/core/admission/gate`.
 *
 * Defaults:
 * - `mockTryAdmit` admits every request, returning `{ release: mockRelease }` (the shared
 *   `mockRelease` no-op, so tests can assert the ticket was released).
 * - `mockAdmissionRejectedResponse` returns the real 429 JSON body with `Retry-After: 5`.
 *
 * @example
 * ```ts
 * import { admissionGateMockFns } from '@sim/testing/mocks/admission-gate.mock'
 *
 * // Admitted (default): the handler must release its slot.
 * expect(admissionGateMockFns.mockRelease).toHaveBeenCalledTimes(1)
 *
 * // Rejected: no slot was granted, so nothing is released.
 * admissionGateMockFns.mockTryAdmit.mockReturnValueOnce(null)
 * expect(admissionGateMockFns.mockRelease).not.toHaveBeenCalled()
 * ```
 */
export const admissionGateMockFns = {
  mockRelease,
  mockTryAdmit: vi.fn((): { release: () => void } | null => ({ release: mockRelease })),
  mockAdmissionRejectedResponse: vi.fn(
    (): Response =>
      Response.json(
        {
          error: 'Too many requests',
          message: 'Server is at capacity. Please retry shortly.',
          code: 'ADMISSION_GATE_CAPACITY',
          retryable: true,
          retryAfterSeconds: 5,
        },
        { status: 429, headers: { 'Retry-After': '5' } }
      )
  ),
}

/**
 * Static mock module for `@/lib/core/admission/gate`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/admission/gate', () => admissionGateMock)
 * ```
 */
export const admissionGateMock = {
  tryAdmit: admissionGateMockFns.mockTryAdmit,
  admissionRejectedResponse: admissionGateMockFns.mockAdmissionRejectedResponse,
}
