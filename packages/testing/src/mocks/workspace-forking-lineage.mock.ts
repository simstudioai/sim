import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/ee/workspace-forking/lib/lineage/lineage`.
 *
 * Every function is a bare `vi.fn()` (resolves `undefined` when awaited): the lock helpers
 * (`setForkLockTimeout`, `acquireForkEdgeLock`, `acquireForkTargetLock`) are therefore no-ops, and
 * the lineage reads (`getForkParentId`, `getForkParent`, `getForkChildren`, `resolveForkEdge`)
 * must be set when a test depends on their result.
 *
 * @example
 * ```ts
 * import { workspaceForkingLineageMockFns } from '@sim/testing/mocks/workspace-forking-lineage.mock'
 *
 * workspaceForkingLineageMockFns.mockResolveForkEdge.mockResolvedValue({
 *   childWorkspaceId: 'ws-child',
 *   parentWorkspaceId: 'ws-parent',
 * })
 * ```
 */
export const workspaceForkingLineageMockFns = {
  mockGetForkParentId: vi.fn(),
  mockGetForkParent: vi.fn(),
  mockGetForkChildren: vi.fn(),
  mockResolveForkEdge: vi.fn(),
  mockSetForkLockTimeout: vi.fn(),
  mockAcquireForkEdgeLock: vi.fn(),
  mockAcquireForkTargetLock: vi.fn(),
  mockAcquireForkLineageLock: vi.fn(),
}

/**
 * Static mock module for `@/ee/workspace-forking/lib/lineage/lineage`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
 * ```
 */
export const workspaceForkingLineageMock = {
  getForkParentId: workspaceForkingLineageMockFns.mockGetForkParentId,
  getForkParent: workspaceForkingLineageMockFns.mockGetForkParent,
  getForkChildren: workspaceForkingLineageMockFns.mockGetForkChildren,
  resolveForkEdge: workspaceForkingLineageMockFns.mockResolveForkEdge,
  setForkLockTimeout: workspaceForkingLineageMockFns.mockSetForkLockTimeout,
  acquireForkEdgeLock: workspaceForkingLineageMockFns.mockAcquireForkEdgeLock,
  acquireForkTargetLock: workspaceForkingLineageMockFns.mockAcquireForkTargetLock,
  acquireForkLineageLock: workspaceForkingLineageMockFns.mockAcquireForkLineageLock,
}
