import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/ee/workspace-forking/lib/lineage/lineage-root`.
 *
 * Both default to a standalone lineage: `resolveForkLineageRootId` returns the workspace it
 * was asked about, and `resolveForkLineageWorkspaceIds` returns the root alone. Override per
 * test to model a moved root or a wider lineage.
 *
 * @example
 * ```ts
 * import { workspaceForkingLineageRootMockFns } from '@sim/testing/mocks/workspace-forking-lineage-root.mock'
 *
 * workspaceForkingLineageRootMockFns.mockResolveForkLineageRootId.mockResolvedValue('root-ws')
 * ```
 */
export const workspaceForkingLineageRootMockFns = {
  mockResolveForkLineageRootId: vi.fn(
    async (_executor: unknown, workspaceId: string) => workspaceId
  ),
  mockResolveForkLineageWorkspaceIds: vi.fn(async (_executor: unknown, rootId: string) => [rootId]),
}

/**
 * Static mock module for `@/ee/workspace-forking/lib/lineage/lineage-root`. Covers every runtime
 * export production code imports.
 *
 * @example
 * ```ts
 * vi.mock('@/ee/workspace-forking/lib/lineage/lineage-root', () => workspaceForkingLineageRootMock)
 * ```
 */
export const workspaceForkingLineageRootMock = {
  resolveForkLineageRootId: workspaceForkingLineageRootMockFns.mockResolveForkLineageRootId,
  resolveForkLineageWorkspaceIds:
    workspaceForkingLineageRootMockFns.mockResolveForkLineageWorkspaceIds,
}
