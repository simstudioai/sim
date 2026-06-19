import { vi } from 'vitest'

/**
 * Real `WorkflowLockedError` subclass used by tests so `instanceof` checks in
 * route handlers behave the same as in production. Mirrors the shape exported
 * by `@sim/platform-authz/workflow`.
 */
export class MockWorkflowLockedError extends Error {
  readonly status = 423

  constructor(message = 'Workflow is locked') {
    super(message)
    this.name = 'WorkflowLockedError'
  }
}

/**
 * Real `FolderLockedError` subclass used by tests so `instanceof` checks in
 * route handlers behave the same as in production. Mirrors the shape exported
 * by `@sim/platform-authz/workflow`.
 */
export class MockFolderLockedError extends Error {
  readonly status = 423

  constructor(message = 'Folder is locked') {
    super(message)
    this.name = 'FolderLockedError'
  }
}

/**
 * Real `FolderNotFoundError` subclass used by tests so `instanceof` checks in
 * route handlers behave the same as in production. Mirrors the shape exported
 * by `@sim/platform-authz/workflow`.
 */
export class MockFolderNotFoundError extends Error {
  readonly status = 400

  constructor(message = 'Target folder not found') {
    super(message)
    this.name = 'FolderNotFoundError'
  }
}

const unlockedStatus = {
  locked: false,
  directLocked: false,
  inheritedLocked: false,
  lockedBy: null as 'workflow' | 'folder' | null,
  lockedFolderId: null as string | null,
}

/**
 * Controllable mocks for the `@sim/platform-authz/workflow` entry.
 *
 * Defaults assume permissive access (no lock, write allowed). Override with
 * `mockResolvedValue` per test when exercising the lock/permission paths.
 *
 * @example
 * ```ts
 * import { workflowAuthzMockFns } from '@sim/testing'
 *
 * workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
 *   allowed: true,
 *   status: 200,
 *   workflow: { id: 'wf-1' },
 *   workspacePermission: 'admin',
 * })
 * ```
 */
export const workflowAuthzMockFns = {
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockGetActiveWorkflowContext: vi.fn(),
  mockGetActiveWorkflowRecord: vi.fn(),
  mockAssertActiveWorkflowContext: vi.fn(),
  mockGetFolderLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockGetWorkflowLockStatus: vi.fn().mockResolvedValue(unlockedStatus),
  mockAssertWorkflowMutable: vi.fn().mockResolvedValue(undefined),
  mockAssertFolderMutable: vi.fn().mockResolvedValue(undefined),
  mockIsFolderInWorkspace: vi.fn().mockResolvedValue(true),
  mockAssertFolderInWorkspace: vi.fn().mockResolvedValue(undefined),
}

/**
 * Static mock module for `@sim/platform-authz/workflow`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/platform-authz/workflow', () => workflowAuthzMock)
 * ```
 */
export const workflowAuthzMock = {
  authorizeWorkflowByWorkspacePermission:
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission,
  getActiveWorkflowContext: workflowAuthzMockFns.mockGetActiveWorkflowContext,
  getActiveWorkflowRecord: workflowAuthzMockFns.mockGetActiveWorkflowRecord,
  assertActiveWorkflowContext: workflowAuthzMockFns.mockAssertActiveWorkflowContext,
  getFolderLockStatus: workflowAuthzMockFns.mockGetFolderLockStatus,
  getWorkflowLockStatus: workflowAuthzMockFns.mockGetWorkflowLockStatus,
  assertWorkflowMutable: workflowAuthzMockFns.mockAssertWorkflowMutable,
  assertFolderMutable: workflowAuthzMockFns.mockAssertFolderMutable,
  isFolderInWorkspace: workflowAuthzMockFns.mockIsFolderInWorkspace,
  assertFolderInWorkspace: workflowAuthzMockFns.mockAssertFolderInWorkspace,
  WorkflowLockedError: MockWorkflowLockedError,
  FolderLockedError: MockFolderLockedError,
  FolderNotFoundError: MockFolderNotFoundError,
}
