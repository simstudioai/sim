import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/internal/principals/executor`.
 * All three are bare `vi.fn()`s: resolve the delegated principal per test.
 *
 * @example
 * ```ts
 * import { executorPrincipalMockFns } from '@sim/testing/mocks/executor-principal.mock'
 *
 * executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext.mockResolvedValue({
 *   kind: 'delegated', serviceId: 'executor', workspaceId: 'ws-1', subjectUserId: 'user-1',
 * })
 * ```
 */
export const executorPrincipalMockFns = {
  mockResolveExecutorOriginSubject: vi.fn(),
  mockCreateExecutorPrincipalFromDelegationOrigin: vi.fn(),
  mockCreateExecutorPrincipalFromExecutionContext: vi.fn(),
}

/**
 * Static mock module for `@/lib/internal/principals/executor`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)
 * ```
 */
export const executorPrincipalMock = {
  resolveExecutorOriginSubject: executorPrincipalMockFns.mockResolveExecutorOriginSubject,
  createExecutorPrincipalFromDelegationOrigin:
    executorPrincipalMockFns.mockCreateExecutorPrincipalFromDelegationOrigin,
  createExecutorPrincipalFromExecutionContext:
    executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext,
}
