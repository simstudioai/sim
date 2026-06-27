import type { ForkOperationReport, ForkReportGroup } from '@/lib/api/contracts/workspace-fork'

/**
 * Assemble a {@link ForkOperationReport}, dropping any zero-count groups so the report
 * stays summary-first and never lists an empty category. Centralizes that invariant
 * across promote, rollback, and the fork modal so the three report builders cannot drift.
 */
export function buildForkReport(params: {
  status: ForkOperationReport['status']
  headline: string
  groups: ForkReportGroup[]
}): ForkOperationReport {
  return {
    status: params.status,
    headline: params.headline,
    groups: params.groups.filter((group) => group.count > 0),
  }
}
