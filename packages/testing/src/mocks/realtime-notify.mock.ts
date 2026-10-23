import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/realtime/notify`.
 *
 * Defaults: the best-effort list/workflow notifiers resolve `undefined` (they never throw in
 * production); `applyEditToLiveFileDoc` resolves `{ applied: false, status: 'no-live-room' }`;
 * `invalidateLiveFileDoc` resolves `undefined`.
 *
 * @example
 * ```ts
 * import { realtimeNotifyMockFns } from '@sim/testing/mocks/realtime-notify.mock'
 *
 * expect(realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged).toHaveBeenCalledWith('ws-1')
 * ```
 */
export const realtimeNotifyMockFns = {
  mockNotifyWorkspaceFilesChanged: vi.fn(async (_workspaceId: string) => undefined),
  mockNotifyWorkspaceTablesChanged: vi.fn(async (_workspaceId: string) => undefined),
  mockNotifyWorkspaceWorkflowsChanged: vi.fn(async (_workspaceId: string) => undefined),
  mockNotifyWorkflowUpdated: vi.fn(async (_workflowId: string) => undefined),
  mockNotifyWorkflowDeleted: vi.fn(async (_workflowId: string) => undefined),
  mockNotifyWorkflowReverted: vi.fn(async (_workflowId: string, _timestamp: number) => undefined),
  mockNotifyFolderResourceChanged: vi.fn(
    async (_resourceType: string, _workspaceId: string) => undefined
  ),
  mockApplyEditToLiveFileDoc: vi.fn(async (..._args: unknown[]) => ({
    applied: false,
    status: 'no-live-room' as 'applied' | 'no-live-room' | 'merge-unavailable' | 'stale',
  })),
  mockInvalidateLiveFileDoc: vi.fn(async (..._args: unknown[]) => undefined),
}

/**
 * Static mock module for `@/lib/realtime/notify`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
 * ```
 */
export const realtimeNotifyMock = {
  notifyWorkspaceFilesChanged: realtimeNotifyMockFns.mockNotifyWorkspaceFilesChanged,
  notifyWorkspaceTablesChanged: realtimeNotifyMockFns.mockNotifyWorkspaceTablesChanged,
  notifyWorkspaceWorkflowsChanged: realtimeNotifyMockFns.mockNotifyWorkspaceWorkflowsChanged,
  notifyWorkflowUpdated: realtimeNotifyMockFns.mockNotifyWorkflowUpdated,
  notifyWorkflowDeleted: realtimeNotifyMockFns.mockNotifyWorkflowDeleted,
  notifyWorkflowReverted: realtimeNotifyMockFns.mockNotifyWorkflowReverted,
  notifyFolderResourceChanged: realtimeNotifyMockFns.mockNotifyFolderResourceChanged,
  applyEditToLiveFileDoc: realtimeNotifyMockFns.mockApplyEditToLiveFileDoc,
  invalidateLiveFileDoc: realtimeNotifyMockFns.mockInvalidateLiveFileDoc,
}
