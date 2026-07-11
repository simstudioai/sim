import { vi } from 'vitest'

/**
 * Real `ResourceLockedError` shape used by tests so `instanceof` checks in
 * route handlers behave the same as in production. Mirrors the class exported
 * by `@sim/platform-authz/resource-lock`.
 */
export class MockResourceLockedError extends Error {
  readonly status = 423
  readonly resourceType: string
  readonly inherited: boolean

  constructor(resourceType: string, inherited: boolean, message?: string) {
    super(message ?? `${resourceType} is locked`)
    this.name = 'ResourceLockedError'
    this.resourceType = resourceType
    this.inherited = inherited
  }
}

const unlockedStatus = {
  locked: false,
  directLocked: false,
  inheritedLocked: false,
  lockedBy: null as 'resource' | 'folder' | null,
  lockedFolderId: null as string | null,
}

/**
 * Controllable mocks for the `@sim/platform-authz/resource-lock` entry.
 *
 * Defaults assume permissive access (no lock). Override with
 * `mockResolvedValue` per test when exercising the lock paths.
 *
 * @example
 * ```ts
 * import { resourceLockMockFns } from '@sim/testing'
 *
 * resourceLockMockFns.mockAssertResourceMutable.mockRejectedValue(
 *   new MockResourceLockedError('knowledge_base', false)
 * )
 * ```
 */
const mockAssertFolderMutable = vi.fn().mockResolvedValue(undefined)
const mockAssertResourceMutable = vi.fn().mockResolvedValue(undefined)

/**
 * Real wrapper logic (not a bare passthrough) so tests that configure
 * `mockAssertFolderMutable`/`mockAssertResourceMutable` to reject with a
 * direct vs. inherited `MockResourceLockedError` see the same "unless
 * unlocking" behavior the production wrappers implement.
 */
async function assertFolderMutableUnlessUnlocking(
  folderId: string | null,
  resourceType: string,
  unlocking: boolean,
  dbClient?: unknown
): Promise<void> {
  try {
    await mockAssertFolderMutable(
      ...[folderId, resourceType, dbClient].filter((a) => a !== undefined)
    )
  } catch (error) {
    if (unlocking && error instanceof MockResourceLockedError && !error.inherited) return
    throw error
  }
}

async function assertResourceMutableUnlessUnlocking(
  resourceType: string,
  resourceId: string,
  unlocking: boolean,
  dbClient?: unknown
): Promise<void> {
  try {
    await mockAssertResourceMutable(
      ...[resourceType, resourceId, dbClient].filter((a) => a !== undefined)
    )
  } catch (error) {
    if (unlocking && error instanceof MockResourceLockedError && !error.inherited) return
    throw error
  }
}

export const resourceLockMockFns = {
  mockGetFolderLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockGetResourceLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockAssertFolderMutable,
  mockAssertResourceMutable,
  mockAssertFolderMutableUnlessUnlocking: vi.fn(assertFolderMutableUnlessUnlocking),
  mockAssertResourceMutableUnlessUnlocking: vi.fn(assertResourceMutableUnlessUnlocking),
}

/**
 * Static mock module for `@sim/platform-authz/resource-lock`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/platform-authz/resource-lock', () => resourceLockMock)
 * ```
 */
export const resourceLockMock = {
  getFolderLockStatus: resourceLockMockFns.mockGetFolderLockStatus,
  getResourceLockStatus: resourceLockMockFns.mockGetResourceLockStatus,
  assertFolderMutable: resourceLockMockFns.mockAssertFolderMutable,
  assertResourceMutable: resourceLockMockFns.mockAssertResourceMutable,
  assertFolderMutableUnlessUnlocking: resourceLockMockFns.mockAssertFolderMutableUnlessUnlocking,
  assertResourceMutableUnlessUnlocking:
    resourceLockMockFns.mockAssertResourceMutableUnlessUnlocking,
  ResourceLockedError: MockResourceLockedError,
}
