import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/mothership/async-runs/repository`.
 *
 * Every repository call is a bare `vi.fn()` except:
 * - `mockWithRunAdmissionLock` runs its `action` with an empty transaction object `{}` and returns
 *   its result (the advisory lock itself is not modelled).
 * - `mockGetClaimedWorkflowExecutionId` is a faithful port (strips the real `'workflow:'` claim prefix).
 * - `mockGetUnsettledStreamSandboxProcesses`, `mockGetUnsettledClientWorkflowExecutions` and
 *   `mockGetAsyncToolCalls` resolve `[]`.
 *
 * @example
 * ```ts
 * import { mothershipAsyncRunsMockFns } from '@sim/testing/mocks/mothership-async-runs.mock'
 *
 * mothershipAsyncRunsMockFns.mockGetLatestRunForStream.mockResolvedValue({ chatId: 'chat-1', status: 'active' })
 * ```
 */
export const mothershipAsyncRunsMockFns = {
  mockWithRunAdmissionLock: vi.fn(
    async (_userId: string, _streamId: string, action: (tx: unknown) => unknown) => action({})
  ),
  mockRequestRunStop: vi.fn(),
  mockIsRunStopRequested: vi.fn(),
  mockCreateRunSegment: vi.fn(),
  mockInsertRunSegment: vi.fn(),
  mockUpdateRunStatus: vi.fn(),
  mockRecordRunBillingAdmission: vi.fn(),
  mockGetLatestRunForStream: vi.fn(),
  mockGetRunSegment: vi.fn(),
  mockUpsertAsyncToolCall: vi.fn(),
  mockGetAsyncToolCall: vi.fn(),
  mockMarkAsyncToolRunning: vi.fn(),
  mockClaimSimToolExecution: vi.fn(),
  mockRenewSimToolExecutionLease: vi.fn(),
  mockRevokeExpiredSimToolExecutions: vi.fn(),
  mockSettleSimToolExecution: vi.fn(),
  mockSettleClientWorkflowToolExecution: vi.fn(),
  mockRecordSimSandboxProcess: vi.fn(),
  mockSettleSimSandboxProcess: vi.fn(),
  mockGetUnsettledStreamSandboxProcesses: vi.fn(
    async (..._args: unknown[]): Promise<unknown[]> => []
  ),
  mockIsActiveSandboxResourceOwner: vi.fn(),
  mockPrepareWorkbenchAccess: vi.fn(),
  mockCloseStreamToolAdmission: vi.fn(),
  mockAreStreamToolExecutionsSettled: vi.fn(),
  mockGetUnsettledClientWorkflowExecutions: vi.fn(
    async (..._args: unknown[]): Promise<unknown[]> => []
  ),
  mockGetClaimedWorkflowExecutionId: vi.fn(
    (claimedBy: string | null | undefined): string | undefined => {
      if (!claimedBy?.startsWith('workflow:')) return undefined
      const executionId = claimedBy.slice('workflow:'.length)
      return executionId.length > 0 ? executionId : undefined
    }
  ),
  mockClaimWorkflowToolExecution: vi.fn(),
  mockReleaseWorkflowToolExecutionClaim: vi.fn(),
  mockClaimPendingAsyncToolCall: vi.fn(),
  mockClaimBrowserDownloadSave: vi.fn(),
  mockCompleteAsyncToolCall: vi.fn(),
  mockCompleteOwnedSimToolCall: vi.fn(),
  mockCompletePendingAsyncToolCall: vi.fn(),
  mockCompleteClaimedAsyncToolCall: vi.fn(),
  mockDetachAsyncToolCall: vi.fn(),
  mockReplaceTerminalAsyncToolCallResult: vi.fn(),
  mockRecordToolPermissionDecision: vi.fn(),
  mockGetAsyncToolCalls: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  mockClaimCompletedAsyncToolCall: vi.fn(),
}

/**
 * Static mock module for `@/lib/mothership/async-runs/repository`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
 * ```
 */
export const mothershipAsyncRunsMock = {
  withRunAdmissionLock: mothershipAsyncRunsMockFns.mockWithRunAdmissionLock,
  requestRunStop: mothershipAsyncRunsMockFns.mockRequestRunStop,
  isRunStopRequested: mothershipAsyncRunsMockFns.mockIsRunStopRequested,
  createRunSegment: mothershipAsyncRunsMockFns.mockCreateRunSegment,
  insertRunSegment: mothershipAsyncRunsMockFns.mockInsertRunSegment,
  updateRunStatus: mothershipAsyncRunsMockFns.mockUpdateRunStatus,
  recordRunBillingAdmission: mothershipAsyncRunsMockFns.mockRecordRunBillingAdmission,
  getLatestRunForStream: mothershipAsyncRunsMockFns.mockGetLatestRunForStream,
  getRunSegment: mothershipAsyncRunsMockFns.mockGetRunSegment,
  upsertAsyncToolCall: mothershipAsyncRunsMockFns.mockUpsertAsyncToolCall,
  getAsyncToolCall: mothershipAsyncRunsMockFns.mockGetAsyncToolCall,
  markAsyncToolRunning: mothershipAsyncRunsMockFns.mockMarkAsyncToolRunning,
  claimSimToolExecution: mothershipAsyncRunsMockFns.mockClaimSimToolExecution,
  renewSimToolExecutionLease: mothershipAsyncRunsMockFns.mockRenewSimToolExecutionLease,
  revokeExpiredSimToolExecutions: mothershipAsyncRunsMockFns.mockRevokeExpiredSimToolExecutions,
  settleSimToolExecution: mothershipAsyncRunsMockFns.mockSettleSimToolExecution,
  settleClientWorkflowToolExecution:
    mothershipAsyncRunsMockFns.mockSettleClientWorkflowToolExecution,
  recordSimSandboxProcess: mothershipAsyncRunsMockFns.mockRecordSimSandboxProcess,
  settleSimSandboxProcess: mothershipAsyncRunsMockFns.mockSettleSimSandboxProcess,
  getUnsettledStreamSandboxProcesses:
    mothershipAsyncRunsMockFns.mockGetUnsettledStreamSandboxProcesses,
  isActiveSandboxResourceOwner: mothershipAsyncRunsMockFns.mockIsActiveSandboxResourceOwner,
  prepareWorkbenchAccess: mothershipAsyncRunsMockFns.mockPrepareWorkbenchAccess,
  closeStreamToolAdmission: mothershipAsyncRunsMockFns.mockCloseStreamToolAdmission,
  areStreamToolExecutionsSettled: mothershipAsyncRunsMockFns.mockAreStreamToolExecutionsSettled,
  getUnsettledClientWorkflowExecutions:
    mothershipAsyncRunsMockFns.mockGetUnsettledClientWorkflowExecutions,
  getClaimedWorkflowExecutionId: mothershipAsyncRunsMockFns.mockGetClaimedWorkflowExecutionId,
  claimWorkflowToolExecution: mothershipAsyncRunsMockFns.mockClaimWorkflowToolExecution,
  releaseWorkflowToolExecutionClaim:
    mothershipAsyncRunsMockFns.mockReleaseWorkflowToolExecutionClaim,
  claimPendingAsyncToolCall: mothershipAsyncRunsMockFns.mockClaimPendingAsyncToolCall,
  claimBrowserDownloadSave: mothershipAsyncRunsMockFns.mockClaimBrowserDownloadSave,
  completeAsyncToolCall: mothershipAsyncRunsMockFns.mockCompleteAsyncToolCall,
  completeOwnedSimToolCall: mothershipAsyncRunsMockFns.mockCompleteOwnedSimToolCall,
  completePendingAsyncToolCall: mothershipAsyncRunsMockFns.mockCompletePendingAsyncToolCall,
  completeClaimedAsyncToolCall: mothershipAsyncRunsMockFns.mockCompleteClaimedAsyncToolCall,
  detachAsyncToolCall: mothershipAsyncRunsMockFns.mockDetachAsyncToolCall,
  replaceTerminalAsyncToolCallResult:
    mothershipAsyncRunsMockFns.mockReplaceTerminalAsyncToolCallResult,
  recordToolPermissionDecision: mothershipAsyncRunsMockFns.mockRecordToolPermissionDecision,
  getAsyncToolCalls: mothershipAsyncRunsMockFns.mockGetAsyncToolCalls,
  claimCompletedAsyncToolCall: mothershipAsyncRunsMockFns.mockClaimCompletedAsyncToolCall,
}
