import { vi } from 'vitest'

/**
 * The real `fileOperations.list` operation from `@/lib/workspace-files/application/operations`,
 * which all three list use cases share.
 */
const FILES_LIST_OPERATION = {
  id: 'files.list',
  oauthScope: 'api:read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  capability: 'files.use',
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

/** `WORKSPACE_FILES_DELEGATION_AUDIENCE`, exposed by every workspace-file use case. */
const WORKSPACE_FILES_DELEGATION_AUDIENCE = 'sim:workspace-files'

/**
 * Controllable mock functions for `@/lib/workspace-files/application/list-workspace-files`. Every
 * function is a bare `vi.fn()`. Each use case is exposed as its `execute` knob (`mock<UseCase>`)
 * and its `authorize` knob (`mock<UseCase>Authorize`).
 *
 * @example
 * ```ts
 * import { workspaceFilesListMockFns } from '@sim/testing/mocks/workspace-files-list.mock'
 *
 * workspaceFilesListMockFns.mockQueryWorkspaceFilePage.mockResolvedValue({ files: [], nextCursor: null })
 * ```
 */
export const workspaceFilesListMockFns = {
  mockListAllWorkspaceFiles: vi.fn(),
  mockListAllWorkspaceFilesAuthorize: vi.fn(),
  mockQueryWorkspaceFilePage: vi.fn(),
  mockQueryWorkspaceFilePageAuthorize: vi.fn(),
  mockListWorkspaceFilesInFolderScope: vi.fn(),
  mockListWorkspaceFilesInFolderScopeAuthorize: vi.fn(),
}

const fns = workspaceFilesListMockFns

/**
 * Static mock module for `@/lib/workspace-files/application/list-workspace-files`. Each use case is
 * `{ operation, delegationAudience, authorize, execute }` with the real `files.list` operation.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspace-files/application/list-workspace-files', () => workspaceFilesListMock)
 * ```
 */
export const workspaceFilesListMock = {
  listAllWorkspaceFiles: {
    operation: FILES_LIST_OPERATION,
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    authorize: fns.mockListAllWorkspaceFilesAuthorize,
    execute: fns.mockListAllWorkspaceFiles,
  },
  queryWorkspaceFilePage: {
    operation: FILES_LIST_OPERATION,
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    authorize: fns.mockQueryWorkspaceFilePageAuthorize,
    execute: fns.mockQueryWorkspaceFilePage,
  },
  listWorkspaceFilesInFolderScope: {
    operation: FILES_LIST_OPERATION,
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    authorize: fns.mockListWorkspaceFilesInFolderScopeAuthorize,
    execute: fns.mockListWorkspaceFilesInFolderScope,
  },
}
