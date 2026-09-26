import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/permission-groups/locks`.
 *
 * Default: `mockAcquirePermissionGroupOrgLock` resolves `undefined` (an instant no-op lock,
 * matching the real `Promise<void>` signature).
 *
 * @example
 * ```ts
 * import { permissionGroupLocksMockFns } from '@sim/testing/mocks/permission-group-locks.mock'
 *
 * expect(permissionGroupLocksMockFns.mockAcquirePermissionGroupOrgLock).toHaveBeenCalledWith(tx, 'org-1')
 * ```
 */
export const permissionGroupLocksMockFns = {
  mockAcquirePermissionGroupOrgLock: vi.fn(
    async (
      _tx: unknown,
      _organizationId: string,
      _options?: { lockTimeoutAlreadyBounded?: boolean }
    ): Promise<void> => undefined
  ),
}

/**
 * Static mock module for `@/lib/permission-groups/locks`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/permission-groups/locks', () => permissionGroupLocksMock)
 * ```
 */
export const permissionGroupLocksMock = {
  acquirePermissionGroupOrgLock: permissionGroupLocksMockFns.mockAcquirePermissionGroupOrgLock,
}
