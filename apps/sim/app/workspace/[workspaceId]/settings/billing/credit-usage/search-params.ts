import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { usageLogPeriodSchema } from '@/lib/api/contracts/user'

/**
 * Co-located, typed URL query-param definitions for the Credit usage page.
 *
 * - `period` shares its literal values with {@link usageLogPeriodSchema} so
 *   the URL parser can never drift from the API contract it filters.
 * - `startDate`/`endDate` are the applied custom range bounds, only
 *   meaningful when `period` is `'custom'`.
 */
export const creditUsageParsers = {
  period: parseAsStringLiteral(usageLogPeriodSchema.options).withDefault('30d'),
  startDate: parseAsString.withDefault(''),
  endDate: parseAsString.withDefault(''),
} as const

/** Filter view-state: clean URLs, no back-stack churn. */
export const creditUsageUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
