import { vi } from 'vitest'

/** Shape of `ActiveWorkspaceApplicationContext` from `@/lib/workspaces/application/workspace-context`. */
export interface MockWorkspaceApplicationContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId?: string
}

/**
 * Stand-in for the `OrchestrationError('not_found', ...)` the real resolver throws. It is a plain
 * `Error` (the mock cannot import the real class), so `instanceof OrchestrationError` is false; a test
 * asserting the not-found projection must reject with a real `OrchestrationError` itself.
 */
class MockWorkspaceNotFoundError extends Error {
  readonly code = 'not_found' as const

  constructor(message = 'Workspace not found') {
    super(message)
    this.name = 'OrchestrationError'
  }
}

/**
 * Builds the default context the mock resolves for any workspace: personal-org-less, personal
 * API keys allowed, billed to `user-1`.
 */
export function createMockWorkspaceApplicationContext(
  overrides: Partial<MockWorkspaceApplicationContext> = {}
): MockWorkspaceApplicationContext {
  return {
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'user-1',
    ...overrides,
  }
}

const mockLoadWorkspaceApplicationContext = vi.fn(
  async (
    workspaceId: string,
    _options?: { includeArchived?: boolean }
  ): Promise<MockWorkspaceApplicationContext | null> =>
    createMockWorkspaceApplicationContext({ workspaceId })
)

const mockLoadActiveWorkspaceApplicationContext = vi.fn(
  (workspaceId: string): Promise<MockWorkspaceApplicationContext | null> =>
    mockLoadWorkspaceApplicationContext(workspaceId)
)

const mockResolveActiveWorkspaceApplicationContext = vi.fn(
  async (workspaceId: string): Promise<MockWorkspaceApplicationContext> => {
    const context = await mockLoadActiveWorkspaceApplicationContext(workspaceId)
    if (!context) throw new MockWorkspaceNotFoundError()
    return context
  }
)

/**
 * Controllable mock functions for `@/lib/workspaces/application/workspace-context`.
 *
 * Defaults delegate like production: `resolveActive…` → `loadActive…` → `load…`, and `load…`
 * resolves {@link createMockWorkspaceApplicationContext} for the requested id. Override the
 * innermost function a test cares about; returning `null` from a loader makes the resolver throw
 * a not-found error.
 *
 * @example
 * ```ts
 * import { workspaceContextMockFns } from '@sim/testing/mocks/workspace-context.mock'
 *
 * workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext.mockResolvedValue(null)
 * workspaceContextMockFns.mockResolveActiveWorkspaceApplicationContext.mockResolvedValue({
 *   workspaceId: 'ws-1', workspaceOrganizationId: 'org-1', allowPersonalApiKeys: false,
 *   billedAccountUserId: 'owner-1',
 * })
 * ```
 */
export const workspaceContextMockFns = {
  mockLoadWorkspaceApplicationContext,
  mockLoadActiveWorkspaceApplicationContext,
  mockResolveActiveWorkspaceApplicationContext,
}

/**
 * Static mock module for `@/lib/workspaces/application/workspace-context`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)
 * ```
 */
export const workspaceContextMock = {
  loadWorkspaceApplicationContext: mockLoadWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext: mockLoadActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext: mockResolveActiveWorkspaceApplicationContext,
}
