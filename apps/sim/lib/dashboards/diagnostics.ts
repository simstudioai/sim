import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/file'
import {
  DASHBOARD_SOURCE_TOO_LARGE,
  MAX_DASHBOARD_SOURCE_BYTES,
  parseDashboardSpec,
} from '@/lib/dashboards/spec'

/**
 * Parse errors for a dashboard file's content, reported on write without blocking it, like
 * the page lint. Undefined for other file types; an empty list means the YAML parsed. Table
 * columns and queries are only checked when the dashboard renders.
 */
export function dashboardDiagnostics(
  contentType: string,
  content: Buffer | string
): string[] | undefined {
  if (contentType !== DASHBOARD_CONTENT_TYPE) return undefined
  if (Buffer.byteLength(content) > MAX_DASHBOARD_SOURCE_BYTES) return [DASHBOARD_SOURCE_TOO_LARGE]
  const { error } = parseDashboardSpec(content.toString())
  return error ? error.split('\n') : []
}
