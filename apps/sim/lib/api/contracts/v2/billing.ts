import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { usageLogPeriodSchema, usageLogSourceSchema } from '@/lib/api/contracts/user'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 billing contracts — the read-only, API-key-facing usage surface.
 *
 * Deliberately separate from the session-only `/api/users/me/usage-logs`
 * endpoints that back the Billing settings UI: the internal surface can evolve
 * with the UI, while this one is the versioned public contract for external
 * monitors. Everything is credit-denominated (Sim's usage unit; 1,000 credits
 * = $5) — raw dollar costs and rate-limit internals are never on this wire.
 */

/** `Date`-constructor-parseable string; validates parseability, not a wire format. */
const parseableDateSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: 'Invalid date' })

export const v2UsageSummaryQuerySchema = z.object({
  /**
   * Restrict the breakdown to one workspace. A workspace-scoped API key is
   * always pinned to its own workspace; passing a different id returns 403.
   */
  workspaceId: z.string().optional(),
})

/**
 * Current-billing-period usage summary. `bySourceCredits` is the source-aware
 * breakdown (workflow, copilot, knowledge-base, …) of the account's ledger for
 * the period, so a monitor can watch one source's consumption directly instead
 * of estimating it by subtraction.
 */
export const v2UsageSummaryDataSchema = z.object({
  period: z.object({ start: z.string(), end: z.string() }),
  totalCredits: z.number(),
  bySourceCredits: z.record(z.string(), z.number()),
  limitCredits: z.number(),
  plan: z.string(),
})
export type V2UsageSummaryData = z.output<typeof v2UsageSummaryDataSchema>

export const v2GetUsageSummaryContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/billing/usage',
  query: v2UsageSummaryQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UsageSummaryDataSchema),
  },
})

export const v2UsageLogsQuerySchema = z
  .object({
    source: usageLogSourceSchema.optional(),
    /** See {@link v2UsageSummaryQuerySchema}'s `workspaceId` — same pinning rules. */
    workspaceId: z.string().optional(),
    period: usageLogPeriodSchema.optional().default('30d'),
    /** Required when `period` is `'custom'`. */
    startDate: parseableDateSchema.optional(),
    /** Defaults to now when omitted for `'custom'`. */
    endDate: parseableDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    cursor: z.string().min(1, 'cursor must be a non-empty token').optional(),
  })
  .refine((query) => query.period !== 'custom' || query.startDate !== undefined, {
    error: 'startDate is required when period is "custom"',
    path: ['startDate'],
  })

/**
 * One credit-consuming usage event. `creditCost` is apportioned across the
 * page so row credits sum exactly to the page's rounded total; it can
 * legitimately be 0 for a sub-credit event once a sibling row absorbs the
 * shared rounding remainder.
 */
export const v2UsageLogEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  source: usageLogSourceSchema,
  /** Populated only when `source` is `'workflow'`. */
  workflowName: z.string().nullable(),
  creditCost: z.number(),
})
export type V2UsageLogEntry = z.output<typeof v2UsageLogEntrySchema>

export const v2ListUsageLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/billing/usage/logs',
  query: v2UsageLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2UsageLogEntrySchema),
  },
})
