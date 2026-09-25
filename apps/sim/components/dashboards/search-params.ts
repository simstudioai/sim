import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { DASHBOARD_RANGES } from '@/lib/dashboards/spec'

/** Null preserves the default authored in each dashboard document. */
export const dashboardParsers = {
  range: parseAsStringLiteral([...DASHBOARD_RANGES, 'custom']),
  from: parseAsString,
  to: parseAsString,
  zone: parseAsStringLiteral(['utc', 'local']).withDefault('local'),
}
export const dashboardTabParser = parseAsString
export const dashboardUrlOptions = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
export function dashboardUrlKeys(fileId: string) {
  return {
    range: `dash-${fileId}-range`,
    from: `dash-${fileId}-from`,
    to: `dash-${fileId}-to`,
    zone: `dash-${fileId}-zone`,
  }
}
