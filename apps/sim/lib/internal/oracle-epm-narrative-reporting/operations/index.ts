import type { OracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

/** Provider capability and execution authority passed by the trusted tool adapter. */
export interface NarrativeOperationContext {
  client: OracleEpmClient
  execution?: InternalToolOperationContext
  signal?: AbortSignal
}

export {
  createLibraryFile,
  createLibraryFolder,
  deleteLibraryArtifact,
  getLibraryArtifact,
  listLibraryArtifacts,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/artifacts'
export {
  downloadBookOutput,
  getBook,
  getBookGlobalPov,
  listBooks,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/books'
export {
  exportLibraryArtifact,
  getJob,
  importLibraryArtifact,
  waitForJob,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/jobs'
export {
  getReportPackage,
  refreshReportPackageDataSources,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-packages'
export {
  createReportSnapshot,
  downloadReportSnapshotOutput,
  getReportSnapshot,
  listReportSnapshots,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-snapshots'
export {
  downloadReportOutput,
  getReport,
  getReportGlobalPov,
  getReportPrompts,
  listReports,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/reports'
