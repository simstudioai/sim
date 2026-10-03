import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/application/workspace-target`.
 *
 * `mockResolveInvocationWorkspace` is bare: authorization of the requested workspace is the
 * behavior callers branch on, so set the resolved target (or a rejection) per test.
 *
 * @example
 * ```ts
 * import { mothershipWorkspaceTargetMockFns } from '@sim/testing/mocks/mothership-workspace-target.mock'
 *
 * mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace.mockResolvedValue({
 *   workspaceId: 'ws-1',
 *   userId: 'user-1',
 * })
 * ```
 */
export const mothershipWorkspaceTargetMockFns = {
  mockResolveInvocationWorkspace: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/application/workspace-target`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
 * ```
 */
export const mothershipWorkspaceTargetMock = {
  resolveInvocationWorkspace: mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace,
}
