import { vi } from 'vitest'

/**
 * Mirrors the module-private `ResumeAdmissionError` thrown by the real
 * `requireResumeDeploymentVersion`: same `name`, `statusCode` and `retryable`.
 */
class MockResumeAdmissionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ResumeAdmissionError'
  }
}

function isMockRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPausedOutputForContext(output: unknown, contextId: string): boolean {
  if (!isMockRecord(output)) return false
  const metadata = output._pauseMetadata
  return isMockRecord(metadata) && metadata.contextId === contextId
}

interface MockAggregationState {
  loopExecutions?: Record<string, unknown>
  parallelExecutions?: Record<string, unknown>
}

interface MockPausePoint {
  pauseKind?: string
  resumeAt?: string | Date | null
}

/**
 * Controllable mock functions for the static methods of `PauseResumeManager`
 * (`@/lib/workflows/executor/human-in-the-loop-manager`). Every method is a bare `vi.fn()`
 * (resolves `undefined`) — configure per-test.
 */
const pauseResumeManagerMockFns = {
  mockPersistPauseResult: vi.fn(),
  mockEnqueueOrStartResume: vi.fn(),
  mockStartResumeExecution: vi.fn(),
  mockMarkResumeAttemptFailed: vi.fn(),
  mockBeginPausedCancellation: vi.fn(),
  mockStagePausedCancellation: vi.fn(),
  mockCompletePausedCancellation: vi.fn(),
  mockFinalizePausedCancellationForTerminalRun: vi.fn(),
  mockBlockQueuedResumesForCancellation: vi.fn(),
  mockGetActiveResumeCancellationTarget: vi.fn(),
  mockGetActiveResumeCancellationTargets: vi.fn(),
  mockRollbackActiveResumeCancellation: vi.fn(),
  mockClearPausedCancellationIntent: vi.fn(),
  mockGetPausedCancellationStatus: vi.fn(),
  mockSetAutomaticResumeWaiting: vi.fn(),
  mockSetNextResumeAt: vi.fn(),
  mockListPausedExecutions: vi.fn(),
  mockGetPausedExecutionById: vi.fn(),
  mockGetPausedExecutionDetail: vi.fn(),
  mockGetPauseContextDetail: vi.fn(),
  mockProcessQueuedResumes: vi.fn(),
}

/**
 * Controllable mock functions for `@/lib/workflows/executor/human-in-the-loop-manager`.
 *
 * Pure helpers are faithful ports of the real logic:
 * - `mockRequireResumeDeploymentVersion` validates draft/deployed mode and throws a 409
 *   `ResumeAdmissionError` (non-retryable) on mismatch.
 * - `mockUpdateResumeOutputInAggregationBuffers` rewrites the paused loop/parallel output in place.
 * - `mockComputeEarliestResumeAt` returns the earliest valid `time` pause `resumeAt` (or `null`).
 *
 * `mockCreateResumeAttemptTimeoutController` and `mockExtractResumeBillingAttributionFromSnapshot`
 * are bare, as is every `PauseResumeManager` static (`mockProcessQueuedResumes`,
 * `mockStartResumeExecution`, `mockGetPausedExecutionDetail`, …).
 *
 * @example
 * ```ts
 * import { humanInTheLoopManagerMockFns } from '@sim/testing/mocks/human-in-the-loop-manager.mock'
 *
 * humanInTheLoopManagerMockFns.mockGetPausedExecutionDetail.mockResolvedValue(null)
 * ```
 */
export const humanInTheLoopManagerMockFns = {
  mockRequireResumeDeploymentVersion: vi.fn(
    (useDraftState: unknown, deploymentVersionId: string | null): string | undefined => {
      if (typeof useDraftState !== 'boolean') {
        throw new MockResumeAdmissionError(
          'Execution mode is missing from the paused run',
          409,
          false
        )
      }
      if (useDraftState) {
        if (deploymentVersionId !== null) {
          throw new MockResumeAdmissionError(
            'Paused draft execution cannot resume from a deployment version',
            409,
            false
          )
        }
        return undefined
      }
      if (!deploymentVersionId) {
        throw new MockResumeAdmissionError(
          'Paused deployed execution is missing its deployment version',
          409,
          false
        )
      }
      return deploymentVersionId
    }
  ),
  mockUpdateResumeOutputInAggregationBuffers: vi.fn(
    (
      state: MockAggregationState,
      stateBlockKey: string,
      pauseBlockId: string,
      contextId: string,
      mergedOutput: Record<string, unknown>
    ): void => {
      for (const scope of Object.values(state.loopExecutions ?? {})) {
        if (!isMockRecord(scope) || !isMockRecord(scope.currentIterationOutputs)) continue
        const outputs = scope.currentIterationOutputs
        const pausedEntry =
          outputs[stateBlockKey] !== undefined
            ? stateBlockKey
            : outputs[pauseBlockId] !== undefined
              ? pauseBlockId
              : undefined
        if (
          pausedEntry !== undefined &&
          isPausedOutputForContext(outputs[pausedEntry], contextId)
        ) {
          if (pausedEntry !== stateBlockKey) {
            delete outputs[pausedEntry]
          }
          outputs[stateBlockKey] = mergedOutput
        }
      }

      for (const scope of Object.values(state.parallelExecutions ?? {})) {
        if (!isMockRecord(scope) || !isMockRecord(scope.branchOutputs)) continue
        const branches = scope.branchOutputs
        for (const [branchIndex, branchOutputs] of Object.entries(branches)) {
          if (!Array.isArray(branchOutputs)) continue
          const outputIndex = branchOutputs.findIndex((output) =>
            isPausedOutputForContext(output, contextId)
          )
          if (outputIndex !== -1) {
            branches[branchIndex] = [
              ...branchOutputs.slice(0, outputIndex),
              mergedOutput,
              ...branchOutputs.slice(outputIndex + 1),
            ]
          }
        }
      }
    }
  ),
  mockCreateResumeAttemptTimeoutController: vi.fn(),
  mockExtractResumeBillingAttributionFromSnapshot: vi.fn(),
  mockComputeEarliestResumeAt: vi.fn(
    (points: Iterable<MockPausePoint>, options: { after?: Date } = {}): Date | null => {
      const { after } = options
      let earliest: Date | null = null
      for (const point of points) {
        if (point.pauseKind !== 'time' || !point.resumeAt) continue
        const candidate = new Date(point.resumeAt)
        if (Number.isNaN(candidate.getTime())) continue
        if (after && candidate <= after) continue
        if (!earliest || candidate < earliest) earliest = candidate
      }
      return earliest
    }
  ),
  ...pauseResumeManagerMockFns,
}

/**
 * Static mock module for `@/lib/workflows/executor/human-in-the-loop-manager`. `PauseResumeManager`
 * is a plain object exposing every public static method as its `humanInTheLoopManagerMockFns` fn.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)
 * ```
 */
export const humanInTheLoopManagerMock = {
  requireResumeDeploymentVersion: humanInTheLoopManagerMockFns.mockRequireResumeDeploymentVersion,
  updateResumeOutputInAggregationBuffers:
    humanInTheLoopManagerMockFns.mockUpdateResumeOutputInAggregationBuffers,
  createResumeAttemptTimeoutController:
    humanInTheLoopManagerMockFns.mockCreateResumeAttemptTimeoutController,
  extractResumeBillingAttributionFromSnapshot:
    humanInTheLoopManagerMockFns.mockExtractResumeBillingAttributionFromSnapshot,
  computeEarliestResumeAt: humanInTheLoopManagerMockFns.mockComputeEarliestResumeAt,
  PauseResumeManager: {
    persistPauseResult: pauseResumeManagerMockFns.mockPersistPauseResult,
    enqueueOrStartResume: pauseResumeManagerMockFns.mockEnqueueOrStartResume,
    startResumeExecution: pauseResumeManagerMockFns.mockStartResumeExecution,
    markResumeAttemptFailed: pauseResumeManagerMockFns.mockMarkResumeAttemptFailed,
    beginPausedCancellation: pauseResumeManagerMockFns.mockBeginPausedCancellation,
    stagePausedCancellation: pauseResumeManagerMockFns.mockStagePausedCancellation,
    completePausedCancellation: pauseResumeManagerMockFns.mockCompletePausedCancellation,
    finalizePausedCancellationForTerminalRun:
      pauseResumeManagerMockFns.mockFinalizePausedCancellationForTerminalRun,
    blockQueuedResumesForCancellation:
      pauseResumeManagerMockFns.mockBlockQueuedResumesForCancellation,
    getActiveResumeCancellationTarget:
      pauseResumeManagerMockFns.mockGetActiveResumeCancellationTarget,
    getActiveResumeCancellationTargets:
      pauseResumeManagerMockFns.mockGetActiveResumeCancellationTargets,
    rollbackActiveResumeCancellation:
      pauseResumeManagerMockFns.mockRollbackActiveResumeCancellation,
    clearPausedCancellationIntent: pauseResumeManagerMockFns.mockClearPausedCancellationIntent,
    getPausedCancellationStatus: pauseResumeManagerMockFns.mockGetPausedCancellationStatus,
    setAutomaticResumeWaiting: pauseResumeManagerMockFns.mockSetAutomaticResumeWaiting,
    setNextResumeAt: pauseResumeManagerMockFns.mockSetNextResumeAt,
    listPausedExecutions: pauseResumeManagerMockFns.mockListPausedExecutions,
    getPausedExecutionById: pauseResumeManagerMockFns.mockGetPausedExecutionById,
    getPausedExecutionDetail: pauseResumeManagerMockFns.mockGetPausedExecutionDetail,
    getPauseContextDetail: pauseResumeManagerMockFns.mockGetPauseContextDetail,
    processQueuedResumes: pauseResumeManagerMockFns.mockProcessQueuedResumes,
  },
}
