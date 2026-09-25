import { vi } from 'vitest'

interface MockLatestJobRow {
  id: string
  type: string
  status: string
  error: string | null
  rowsProcessed: number
  doomedCount?: number | null
}

const EMPTY_JOB_FIELDS = {
  jobStatus: null,
  jobId: null,
  jobType: null,
  jobError: null,
  jobRowsProcessed: 0,
  pendingDeleteRemaining: 0,
}

/**
 * Controllable mock functions for `@/lib/table/jobs/service`.
 *
 * Defaults: `mapJobRow` is the real pure projection (`EMPTY_JOB_FIELDS` for a missing row),
 * `latestJobsForTables` resolves an empty `Map`. Every other function (including the SQL builder
 * `latestNonExportJobJson`) is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableJobsServiceMockFns } from '@sim/testing/mocks/table-jobs-service.mock'
 *
 * tableJobsServiceMockFns.mockMarkTableJobRunning.mockResolvedValue(true)
 * ```
 */
export const tableJobsServiceMockFns = {
  mockMapJobRow: vi.fn((row: MockLatestJobRow | null | undefined) => {
    if (!row) return EMPTY_JOB_FIELDS
    const doomedCount =
      row.type === 'delete' && row.status === 'running' ? (row.doomedCount ?? 0) : 0
    return {
      jobStatus: row.status,
      jobId: row.id,
      jobType: row.type,
      jobError: row.error,
      jobRowsProcessed: row.rowsProcessed,
      pendingDeleteRemaining: Math.max(0, doomedCount - row.rowsProcessed),
    }
  }),
  mockLatestJobsForTables: vi.fn(
    async (_tableIds: string[]): Promise<Map<string, unknown>> => new Map()
  ),
  mockLatestNonExportJobJson: vi.fn(),
  mockMarkTableJobRunning: vi.fn(),
  mockMarkTableJobRunningInWorkspace: vi.fn(),
  mockReleaseJobClaim: vi.fn(),
  mockReleaseJobClaimInWorkspace: vi.fn(),
  mockUpdateJobProgress: vi.fn(),
  mockUpdateJobProgressInWorkspace: vi.fn(),
  mockRecordImportRejections: vi.fn(),
  mockGetJobProgress: vi.fn(),
  mockSelectExportRowPage: vi.fn(),
  mockListWorkspaceExportJobs: vi.fn(),
  mockGetTableJob: vi.fn(),
  mockSetJobResultKeyInWorkspace: vi.fn(),
  mockMarkJobReady: vi.fn(),
  mockMarkJobReadyInWorkspace: vi.fn(),
  mockMarkJobFailed: vi.fn(),
  mockMarkJobFailedInWorkspace: vi.fn(),
  mockMarkJobCanceled: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/jobs/service`. `EMPTY_JOB_FIELDS` carries the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/jobs/service', () => tableJobsServiceMock)
 * ```
 */
export const tableJobsServiceMock = {
  EMPTY_JOB_FIELDS,
  mapJobRow: tableJobsServiceMockFns.mockMapJobRow,
  latestNonExportJobJson: tableJobsServiceMockFns.mockLatestNonExportJobJson,
  latestJobsForTables: tableJobsServiceMockFns.mockLatestJobsForTables,
  markTableJobRunning: tableJobsServiceMockFns.mockMarkTableJobRunning,
  markTableJobRunningInWorkspace: tableJobsServiceMockFns.mockMarkTableJobRunningInWorkspace,
  releaseJobClaim: tableJobsServiceMockFns.mockReleaseJobClaim,
  releaseJobClaimInWorkspace: tableJobsServiceMockFns.mockReleaseJobClaimInWorkspace,
  updateJobProgress: tableJobsServiceMockFns.mockUpdateJobProgress,
  updateJobProgressInWorkspace: tableJobsServiceMockFns.mockUpdateJobProgressInWorkspace,
  recordImportRejections: tableJobsServiceMockFns.mockRecordImportRejections,
  getJobProgress: tableJobsServiceMockFns.mockGetJobProgress,
  selectExportRowPage: tableJobsServiceMockFns.mockSelectExportRowPage,
  listWorkspaceExportJobs: tableJobsServiceMockFns.mockListWorkspaceExportJobs,
  getTableJob: tableJobsServiceMockFns.mockGetTableJob,
  setJobResultKeyInWorkspace: tableJobsServiceMockFns.mockSetJobResultKeyInWorkspace,
  markJobReady: tableJobsServiceMockFns.mockMarkJobReady,
  markJobReadyInWorkspace: tableJobsServiceMockFns.mockMarkJobReadyInWorkspace,
  markJobFailed: tableJobsServiceMockFns.mockMarkJobFailed,
  markJobFailedInWorkspace: tableJobsServiceMockFns.mockMarkJobFailedInWorkspace,
  markJobCanceled: tableJobsServiceMockFns.mockMarkJobCanceled,
}
