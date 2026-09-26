import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/application/context`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableApplicationContextMockFns } from '@sim/testing/mocks/table-application-context.mock'
 *
 * tableApplicationContextMockFns.mockResolveActiveTableContext.mockResolvedValue({
 *   workspaceId: 'ws-1',
 *   table,
 * })
 * ```
 */
export const tableApplicationContextMockFns = {
  mockResolveTableWorkspaceContext: vi.fn(),
  mockResolveActiveTableContext: vi.fn(),
  mockResolveActiveTableInWorkspace: vi.fn(),
  mockResolveArchivedTableContext: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/application/context`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
 * ```
 */
export const tableApplicationContextMock = {
  resolveTableWorkspaceContext: tableApplicationContextMockFns.mockResolveTableWorkspaceContext,
  resolveActiveTableContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  resolveActiveTableInWorkspace: tableApplicationContextMockFns.mockResolveActiveTableInWorkspace,
  resolveArchivedTableContext: tableApplicationContextMockFns.mockResolveArchivedTableContext,
}
