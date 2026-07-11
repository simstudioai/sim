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
export const resourceLockMockFns = {
  mockGetFolderLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockGetResourceLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockAssertFolderMutable: vi.fn().mockResolvedValue(undefined),
  mockAssertResourceMutable: vi.fn().mockResolvedValue(undefined),
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
  ResourceLockedError: MockResourceLockedError,
}
