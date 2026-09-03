import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const TABLE_REFERENCE_COLUMNS_DISABLED_MESSAGE =
  'Reference columns are not enabled for this deployment'

/** Resolves the global runtime gate for Reference column behavior. */
export function areTableReferenceColumnsEnabled(): Promise<boolean> {
  return isFeatureEnabled('table-reference-columns')
}

/** Rejects mutations that introduce or reconfigure a Reference column. */
export async function assertTableReferenceColumnsEnabled(): Promise<void> {
  if (!(await areTableReferenceColumnsEnabled())) {
    throw new OrchestrationError('forbidden', TABLE_REFERENCE_COLUMNS_DISABLED_MESSAGE)
  }
}
