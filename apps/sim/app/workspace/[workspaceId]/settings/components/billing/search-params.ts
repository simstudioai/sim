import { parseAsStringLiteral } from 'nuqs/server'
import { usageLogPeriodSchema } from '@/lib/api/contracts/user'

/**
 * Co-located, typed URL query-param definitions for the Billing settings
 * view.
 *
 * - `period` is the Credit usage section's time-window filter, sharing its
 *   literal values with {@link usageLogPeriodSchema} so the URL parser can
 *   never drift from the API contract it filters.
 */
export const billingParsers = {
  period: parseAsStringLiteral(usageLogPeriodSchema.options).withDefault('30d'),
} as const

/** Filter view-state: clean URLs, no back-stack churn. */
export const billingUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const
