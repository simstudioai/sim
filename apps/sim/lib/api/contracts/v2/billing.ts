import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { usageLogPeriodSchema, usageLogSourceSchema } from '@/lib/api/contracts/user'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 billing contracts — separate read-only status and ledger resources.
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

export const v2BillingStatusQuerySchema = z.object({
  /**
   * Resolve status against one workspace's payer. A workspace-scoped API key
   * is always pinned to its own workspace; passing a different id returns 403.
   */
  workspaceId: z.string().optional(),
})

/**
 * Current billing standing and credit allowance. Ledger rows and source
 * analytics deliberately live outside this status resource.
 */
export const v2BillingStatusDataSchema = z.object({
  workspaceId: z.string().nullable(),
  period: z.object({ start: z.string(), end: z.string() }),
  plan: z.string(),
  status: z.enum(['active', 'limit_exceeded', 'billing_blocked']),
  credits: z.object({
    used: z.number(),
    limit: z.number(),
    remaining: z.number(),
  }),
})
export type V2BillingStatusData = z.output<typeof v2BillingStatusDataSchema>

export const v2GetBillingStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/billing/status',
  query: v2BillingStatusQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BillingStatusDataSchema),
  },
})

export const v2BillingLogsQuerySchema = z
  .object({
    source: usageLogSourceSchema.optional(),
    /** See {@link v2BillingStatusQuerySchema}'s `workspaceId` — same pinning rules. */
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
export const v2BillingLogEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  source: usageLogSourceSchema,
  workspaceId: z.string().nullable(),
  workflow: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
    })
    .nullable(),
  runId: z.string().nullable(),
  creditCost: z.number(),
})
export type V2BillingLogEntry = z.output<typeof v2BillingLogEntrySchema>

export const v2ListBillingLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/billing/logs',
  query: v2BillingLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2BillingLogEntrySchema),
  },
})
