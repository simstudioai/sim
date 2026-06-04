import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/app/api/workflows/utils`.
 *
 * Default `createSuccessResponse`/`createErrorResponse` return a mock Response-like
 * object where `.json()` resolves to the payload — compatible with most assertions
 * like `expect(await res.json()).toEqual(...)` and `expect(res.status).toBe(...)`.
 *
 * @example
 * ```ts
 * import { workflowsApiUtilsMockFns } from '@sim/testing'
 *
 * workflowsApiUtilsMockFns.mockVerifyWorkspaceMembership.mockResolvedValue('admin')
 * workflowsApiUtilsMockFns.mockCheckNeedsRedeployment.mockResolvedValue(true)
 * ```
 */
export const workflowsApiUtilsMockFns = {
  mockCreateSuccessResponse: vi.fn((data: unknown) => ({
    status: 200,
    ok: true,
    json: async () => data,
  })),
  mockCreateErrorResponse: vi.fn((error: string, status: number, code?: string) => ({
    status,
    ok: false,
    json: async () => ({
      error,
      code: code || error.toUpperCase().replace(/\s+/g, '_'),
    }),
  })),
  mockCheckNeedsRedeployment: vi.fn().mockResolvedValue(false),
  mockVerifyWorkspaceMembership: vi.fn().mockResolvedValue('member'),
}

/**
 * Static mock module for `@/app/api/workflows/utils`.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)
 * ```
 */
export const workflowsApiUtilsMock = {
  createSuccessResponse: workflowsApiUtilsMockFns.mockCreateSuccessResponse,
  createErrorResponse: workflowsApiUtilsMockFns.mockCreateErrorResponse,
  checkNeedsRedeployment: workflowsApiUtilsMockFns.mockCheckNeedsRedeployment,
  verifyWorkspaceMembership: workflowsApiUtilsMockFns.mockVerifyWorkspaceMembership,
}
