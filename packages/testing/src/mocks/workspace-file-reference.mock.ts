import { vi } from 'vitest'

/**
 * Controllable mock functions for
 * `@/lib/workspace-files/application/resolve-workspace-file-reference`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { workspaceFileReferenceMockFns } from '@sim/testing/mocks/workspace-file-reference.mock'
 *
 * workspaceFileReferenceMockFns.mockResolveWorkspaceFileReference.mockResolvedValue(fileRecord)
 * ```
 */
export const workspaceFileReferenceMockFns = {
  mockResolveReferencedWorkspaceFileContext: vi.fn(),
  mockResolveWorkspaceFileReference: vi.fn(),
  mockReadWorkspaceFileReference: vi.fn(),
}

/**
 * Static mock module for `@/lib/workspace-files/application/resolve-workspace-file-reference`.
 *
 * @example
 * ```ts
 * vi.mock(
 *   '@/lib/workspace-files/application/resolve-workspace-file-reference',
 *   () => workspaceFileReferenceMock
 * )
 * ```
 */
export const workspaceFileReferenceMock = {
  resolveReferencedWorkspaceFileContext:
    workspaceFileReferenceMockFns.mockResolveReferencedWorkspaceFileContext,
  resolveWorkspaceFileReference: workspaceFileReferenceMockFns.mockResolveWorkspaceFileReference,
  readWorkspaceFileReference: workspaceFileReferenceMockFns.mockReadWorkspaceFileReference,
}
