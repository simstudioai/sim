import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
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
  workspaceId: workspaceIdSchema
    .optional()
    .describe(
      'Workspace whose payer should be resolved. Workspace API keys are pinned to their own workspace.'
    ),
})

/**
 * Current billing standing, credit allowance, and storage quota. Ledger rows
 * and source analytics deliberately live outside this status resource.
 *
 * `credits` and `storage` report the resolved payer's pooled allowances, which
 * are shared across every workspace and member that payer funds. They are
 * populated only for a caller who may manage that payer's billing: the billed
 * account holder, or an admin of the owning organization. Billing authority is
 * a property of a person, so an actor-less workspace API key never qualifies.
 * This holds on both scopes — omitting `workspaceId` resolves the payer from
 * the caller's own subscriptions and organization memberships, and plain
 * membership is not authority over the organization's pool. Every other caller
 * reads both as `null` while still seeing the plan, period, and standing of
 * the payer that funds them — enough to monitor for `limit_exceeded` and
 * `billing_blocked`.
 */
export const v2BillingStatusDataSchema = z
  .object({
    workspaceId: z
      .string()
      .nullable()
      .describe('Workspace whose payer was resolved, or null for account billing.'),
    period: z
      .object({
        start: z
          .string()
          .describe(
            'ISO 8601 start of the current billing period, or 1970-01-01T00:00:00.000Z when no Stripe subscription defines one.'
          )
          .meta({ format: 'date-time' }),
        end: z
          .string()
          .describe(
            'ISO 8601 end of the current billing period, or 9999-12-31T00:00:00.000Z when no Stripe subscription defines one.'
          )
          .meta({ format: 'date-time' }),
      })
      .describe(
        'Current billing period. Only a Stripe subscription defines a real period; without one — notably on the free plan — this is the open interval 1970-01-01 to 9999-12-31 and must not be read as a monthly window.'
      ),
    plan: z.string().describe('Current billing plan.'),
    status: z
      .enum(['active', 'limit_exceeded', 'billing_blocked'])
      .describe('Current billing standing.'),
    credits: z
      .object({
        used: z
          .number()
          .describe(
            'Credits consumed so far. The counter is reset by Stripe invoice webhooks, so on a paid plan it covers the current billing period; on the free plan nothing resets it and the value is lifetime consumption.'
          ),
        limit: z
          .number()
          .describe(
            'Credit allowance for the reporting window — per billing period on a paid plan, lifetime on the free plan.'
          ),
        remaining: z.number().describe('Allowance minus consumption, over the same window.'),
      })
      .nullable()
      .describe(
        "The payer's credit usage and allowance — periodic on a paid plan, lifetime on the free plan, where the counter never resets. Null when the caller cannot manage that payer's billing. Always null for a workspace API key."
      ),
    storage: z
      .object({
        usedBytes: z.number().nonnegative().describe('Storage currently consumed, in bytes.'),
        limitBytes: z.number().nonnegative().describe('Storage quota, in bytes.'),
        percentUsed: z.number().nonnegative().describe('Percentage of the storage quota consumed.'),
      })
      .nullable()
      .describe(
        "The payer's storage consumption and quota, or null when the caller cannot manage that payer's billing. Always null for a workspace API key."
      ),
  })
  .meta({
    id: 'V2BillingStatus',
    title: 'Billing status',
    description: 'Current billing standing, credit allowance, and storage quota.',
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
    source: usageLogSourceSchema.optional().describe('Restrict results to one usage source.'),
    /** See {@link v2BillingStatusQuerySchema}'s `workspaceId` — same pinning rules. */
    workspaceId: workspaceIdSchema
      .optional()
      .describe('Restrict results to one workspace whose payer the caller can inspect.'),
    period: usageLogPeriodSchema
      .optional()
      .default('30d')
      .describe('Relative window, all history, or a custom date range.'),
    /** Required when `period` is `'custom'`. */
    startDate: parseableDateSchema
      .optional()
      .describe('Start of a custom window as a Date-parseable string.'),
    /** Defaults to now when omitted for `'custom'`. */
    endDate: parseableDateSchema
      .optional()
      .describe('End of a custom window as a Date-parseable string; defaults to now.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe('Maximum usage events per page, from 1 to 100.'),
    cursor: z
      .string()
      .min(1, 'cursor must be a non-empty token')
      .optional()
      .describe('Opaque cursor returned by the previous page.'),
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
export const v2BillingLogEntrySchema = z
  .object({
    id: z.string().describe('Unique usage-event identifier.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the usage event was recorded.')
      .meta({ format: 'date-time' }),
    source: usageLogSourceSchema.describe('Product surface that consumed the credits.'),
    workspaceId: z
      .string()
      .nullable()
      .describe('Workspace attributed to the event, or null for account-level usage.'),
    workflow: z
      .object({
        id: z.string().describe('Workflow identifier.'),
        name: z.string().nullable().describe('Workflow display name, when available.'),
      })
      .nullable()
      .describe('Workflow attributed to the event, when applicable.'),
    runId: z.string().nullable().describe('Workflow run attributed to the event, when applicable.'),
    creditCost: z
      .number()
      .describe(
        'Credits apportioned to the event so page rows sum to the rounded page total; may be zero for a sub-credit event.'
      ),
  })
  .meta({
    id: 'V2BillingLogEntry',
    title: 'Billing log entry',
    description: 'One credit-consuming usage event in the billing ledger.',
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
