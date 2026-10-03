import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { TableRowTtlDisabledError } from '@/lib/table/errors'

/** Whether TTL columns and their cleanup behavior are enabled globally. */
export function isTableRowTtlEnabled(): Promise<boolean> {
  return isFeatureEnabled('table-row-ttl')
}

/** Rejects attempts to introduce a TTL column while the feature is disabled. */
export async function assertTableRowTtlEnabled(): Promise<void> {
  if (await isTableRowTtlEnabled()) return
  throw new TableRowTtlDisabledError()
}
