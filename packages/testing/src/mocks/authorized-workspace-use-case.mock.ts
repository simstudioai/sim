import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/application/authorized-workspace-use-case`.
 *
 * `mockRecordProjectedUseCaseAuditEntries` is a no-op (records nothing) — assert on its calls.
 * `mockDefineAuthorizedWorkspaceUseCase` is a bare `vi.fn()` (returns `undefined`): a suite whose
 * subject module builds its use cases at load time needs the real module, or an implementation.
 *
 * @example
 * ```ts
 * import { authorizedWorkspaceUseCaseMockFns } from '@sim/testing/mocks/authorized-workspace-use-case.mock'
 *
 * expect(authorizedWorkspaceUseCaseMockFns.mockRecordProjectedUseCaseAuditEntries).toHaveBeenCalledWith(
 *   operation, 'ws-1', principal, undefined, [expect.objectContaining({ action: 'x' })]
 * )
 * ```
 */
export const authorizedWorkspaceUseCaseMockFns = {
  mockRecordProjectedUseCaseAuditEntries: vi.fn(
    (
      _operation: unknown,
      _workspaceId: string | null | undefined,
      _principal: unknown,
      _request: unknown,
      _entries: readonly unknown[],
      _organizationId?: string
    ): void => {}
  ),
  mockDefineAuthorizedWorkspaceUseCase: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/application/authorized-workspace-use-case`. Covers every
 * runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/application/authorized-workspace-use-case', () => authorizedWorkspaceUseCaseMock)
 * ```
 */
export const authorizedWorkspaceUseCaseMock = {
  recordProjectedUseCaseAuditEntries:
    authorizedWorkspaceUseCaseMockFns.mockRecordProjectedUseCaseAuditEntries,
  defineAuthorizedWorkspaceUseCase:
    authorizedWorkspaceUseCaseMockFns.mockDefineAuthorizedWorkspaceUseCase,
}
