import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/permission-groups/config-scope.server`.
 *
 * `mockResolvePermissionGroupConfig` is the one seam every capability gate reads
 * — `assertWorkspaceCapability`, `isWorkspaceCapabilityWithheld`, and the
 * authorization funnel all resolve the governing config through it. Mock this
 * rather than `@/ee/access-control/utils/permission-check`, which sits a layer
 * below the memo and is not what the gates call.
 *
 * Resolve `null` for the ungoverned case (a personal workspace, or any
 * non-enterprise organization) and a spread of `DEFAULT_PERMISSION_GROUP_CONFIG`
 * for a group that governs the user.
 *
 * @example
 * ```ts
 * import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
 *
 * vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
 *
 * permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
 *   ...DEFAULT_PERMISSION_GROUP_CONFIG,
 *   hideInboxTab: true,
 * })
 * ```
 */
export const permissionGroupScopeMockFns = {
  mockResolvePermissionGroupConfig: vi.fn(),
}

/**
 * Static mock module for `@/lib/permission-groups/config-scope.server`.
 *
 * `withPermissionGroupScope` is a real passthrough rather than a `vi.fn()`
 * because `withRouteHandler` calls it to wrap every route handler. A factory
 * that exports only `resolvePermissionGroupConfig` leaves it `undefined`, and
 * the route then fails with a 500 that looks nothing like the gate under test.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
 * ```
 */
export const permissionGroupScopeMock = {
  resolvePermissionGroupConfig: permissionGroupScopeMockFns.mockResolvePermissionGroupConfig,
  withPermissionGroupScope: <R>(run: () => R): R => run(),
}

/** Restores the ungoverned default — no group governs the user. */
export function resetPermissionGroupScopeMock(): void {
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockReset()
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)
}
