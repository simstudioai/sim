import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/api`.
 *
 * Defaults: `mockAuthenticate` (the `internalTableSessionOrExecutorAuth.authenticate` method) is a
 * bare `vi.fn()`; every internal error policy's `project` and every v2 error policy's `render`
 * returns `null` (the error is not projected, so the route falls through to its generic handling).
 *
 * @example
 * ```ts
 * import { tableApiMockFns } from '@sim/testing/mocks/table-api.mock'
 *
 * tableApiMockFns.mockAuthenticate.mockResolvedValue({ kind: 'session', userId: 'user-1', sessionId: 's-1' })
 * ```
 */
export const tableApiMockFns = {
  mockAuthenticate: vi.fn(),
  mockInternalBulkProject: vi.fn((_error: unknown): unknown => null),
  mockInternalConcealTableAuthorizationProject: vi.fn((_error: unknown): unknown => null),
  mockInternalConcealTableGroupAuthorizationProject: vi.fn((_error: unknown): unknown => null),
  mockInternalConcealImportAuthorizationProject: vi.fn((_error: unknown): unknown => null),
  mockInternalConcealExportAuthorizationProject: vi.fn((_error: unknown): unknown => null),
  mockV2DefaultRender: vi.fn((_error: unknown): unknown => null),
  mockV2ConcealTableAuthorizationRender: vi.fn((_error: unknown): unknown => null),
  mockV2ConcealImportAuthorizationRender: vi.fn((_error: unknown): unknown => null),
  mockV2ConcealExportAuthorizationRender: vi.fn((_error: unknown): unknown => null),
  mockV2BulkRender: vi.fn((_error: unknown): unknown => null),
}

const fns = tableApiMockFns

/**
 * Static mock module for `@/lib/table/api` (the route-policy barrel). Policy objects carry the
 * real keys: `internalTableErrorPolicies.{bulk, concealTableAuthorization,
 * concealTableGroupAuthorization, concealImportAuthorization, concealExportAuthorization}` each
 * expose `project`; `v2TableErrorPolicies.{default, concealTableAuthorization,
 * concealImportAuthorization, concealExportAuthorization, bulk}` each expose `render`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/api', () => tableApiMock)
 * ```
 */
export const tableApiMock = {
  internalTableSessionOrExecutorAuth: { authenticate: fns.mockAuthenticate },
  internalTableErrorPolicies: {
    bulk: { project: fns.mockInternalBulkProject },
    concealTableAuthorization: { project: fns.mockInternalConcealTableAuthorizationProject },
    concealTableGroupAuthorization: {
      project: fns.mockInternalConcealTableGroupAuthorizationProject,
    },
    concealImportAuthorization: { project: fns.mockInternalConcealImportAuthorizationProject },
    concealExportAuthorization: { project: fns.mockInternalConcealExportAuthorizationProject },
  },
  v2TableErrorPolicies: {
    default: { render: fns.mockV2DefaultRender },
    concealTableAuthorization: { render: fns.mockV2ConcealTableAuthorizationRender },
    concealImportAuthorization: { render: fns.mockV2ConcealImportAuthorizationRender },
    concealExportAuthorization: { render: fns.mockV2ConcealExportAuthorizationRender },
    bulk: { render: fns.mockV2BulkRender },
  },
}
