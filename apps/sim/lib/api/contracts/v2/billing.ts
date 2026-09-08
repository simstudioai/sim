import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { usageLogPeriodSchema, usageLogSourceSchema } from '@/lib/api/contracts/user'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2RunWindowBoundSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 billing contracts — separate read-only status and ledger resources.
 *
 * Deliberately separate from the session-only `/api/users/me/usage-logs`
 * endpoints that back the Billing settings UI: the internal surface can evolve
 * with the UI, while this one is the versioned public contract for external
 * monitors. Everything is credit-denominated (Sim's usage unit; 1,000 credits
 * = $5) — raw dollar costs and rate-limit internals are never on this wire.
 */

/**
 * `.strict()` carries more weight here than on an ordinary read. `workspaceId` is
 * optional and selects *which payer* is reported, so a key Zod would otherwise strip —
 * a mis-cased `workspaceID`, or a param copied from a sibling contract — silently
 * demotes a workspace-scoped question to account scope and answers 200 about a
 * different payer than the caller asked about. It is a wrong answer, not a cross-tenant
 * read: `resolveBillingReadScope` still pins a workspace API key to its own workspace
 * whatever the query says, so the reachable case is a user-held credential being told
 * about its own account when it asked about a workspace. Rejecting the unknown key turns that
 * wrong answer about money into a 400.
 */
export const v2BillingStatusQuerySchema = z
  .object({
    /**
     * Resolve status against one workspace's payer. A workspace-scoped API key
     * is always pinned to its own workspace; passing a different id is concealed
     * as `404 Workspace not found`, indistinguishable from an id that does not
     * exist — the cross-tenant concealment every v2 resource read applies, not a
     * 403.
     */
    workspaceId: workspaceIdSchema
      .optional()
      .describe(
        'Workspace whose payer should be resolved. A workspace API key is pinned to its own workspace: any other id answers `404 Workspace not found`, which is also what an id that does not exist answers.'
      ),
  })
  .strict()

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

/**
 * Unlike the keyset lists, this ledger's `cursor` is a usage-event id resolved by
 * lookup rather than a self-describing opaque cursor, so it cannot be re-validated
 * from its own contents. A cursor that names no usage event is a 400
 * (`UNKNOWN_CURSOR_MESSAGE`) rather than an unpositioned first page, so a pager
 * holding a cursor from another environment or a wiped ledger fails loudly instead
 * of looping over page 1 and counting the same credits on every lap.
 */
/**
 * The ledger's window bounds, hoisted so the ordering refinement below can ask
 * the *same* schema whether a bound is a usable instant. `Date.parse` is a
 * strictly wider parser than this one — it accepts a UTC offset instead of `Z`,
 * and it accepts year `0000` — so a bound this schema has already rejected can
 * still yield a number and drag the ordering comparison into answering a
 * question about a value the caller was just told is not acceptable.
 */
const billingWindowStartSchema = v2RunWindowBoundSchema('startDate').describe(
  'Only include usage events recorded at or after this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. Requires `period=custom`. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.'
)
const billingWindowEndSchema = v2RunWindowBoundSchema('endDate').describe(
  'Only include usage events recorded at or before this UTC ISO 8601 timestamp, e.g. `2026-08-06T00:00:00Z`. Requires `period=custom`, and defaults to now when omitted. A date without a time, or a timestamp carrying a UTC offset instead of `Z`, is rejected, as is year `0000`, which names no storable instant.'
)

export const v2BillingLogsQuerySchema = z
  .object({
    source: usageLogSourceSchema.optional().describe('Restrict results to one usage source.'),
    /**
     * See {@link v2BillingStatusQuerySchema}'s `workspaceId` — same pinning rules.
     *
     * This narrows the rows; it does not change *whose* rows they are. That is
     * decided by the kind of key, and the response reports it as `scope`.
     */
    workspaceId: workspaceIdSchema
      .optional()
      .describe(
        "Narrow the ledger to one workspace. An OAuth token or personal API key reports only its user's events; a workspace API key reports every member's events in its bound workspace. The response `scope` identifies which view was returned. A workspace key asking for another workspace receives the same `404 Workspace not found` as an unknown id."
      ),
    period: usageLogPeriodSchema
      .optional()
      .default('30d')
      .describe(
        'Relative window, all history, or a custom date range. `startDate` and `endDate` are accepted only with `custom`; every other value computes its own window.'
      ),
    /** Required when `period` is `'custom'`, and rejected otherwise. */
    startDate: billingWindowStartSchema.optional(),
    /** Defaults to now when omitted for `'custom'`; rejected for every other period. */
    endDate: billingWindowEndSchema.optional(),
    ...v2PaginationFields({ description: 'Maximum usage events per page.' }),
  })
  .strict()
  .refine((query) => query.period !== 'custom' || query.startDate !== undefined, {
    error: 'startDate is required when period is "custom"',
    path: ['startDate'],
  })
  /**
   * `.strict()` only rejects keys the schema does not declare. Both bounds *are*
   * declared, and `resolveDateRange` reads them in the `'custom'` branch alone, so
   * a bound sent with any other period parsed, was accepted, and was then dropped —
   * the query answered 200 over the default 30-day window. On a ledger a caller
   * reconciles charges against, that is the worst shape of wrong answer: the rows
   * are real, they are simply not the rows that were asked for, and nothing in the
   * response distinguishes the two. Rejecting names the escape hatch instead.
   */
  .superRefine((query, ctx) => {
    if (query.period === 'custom') return
    for (const field of ['startDate', 'endDate'] as const) {
      if (query[field] === undefined) continue
      ctx.addIssue({
        code: 'custom',
        message: `${field} is only accepted when period=custom; period="${query.period}" computes its own window`,
        path: [field],
      })
    }
  })
  /**
   * Parity with `GET /logs` and `GET /workflows/{workflowId}/runs`, which reject an
   * inverted window rather than answering with the empty page an unsatisfiable
   * `createdAt >= start AND createdAt <= end` produces.
   */
  .refine(
    (query) => {
      if (!query.startDate || !query.endDate) return true
      /**
       * A bound that already failed its own format check still reaches this
       * comparison — an object refinement runs whatever its shape reported.
       * Ordering is a question about two instants, so it can only be asked once
       * both bounds *are* instants by this contract's definition; otherwise the
       * caller is told its window is inverted on top of the issue naming the
       * value that was not acceptable in the first place. The gate is the bound
       * schema itself rather than `Date.parse`, which accepts shapes this
       * contract rejects — an offset instead of `Z`, or year `0000`.
       */
      if (
        !billingWindowStartSchema.safeParse(query.startDate).success ||
        !billingWindowEndSchema.safeParse(query.endDate).success
      ) {
        return true
      }
      return Date.parse(query.startDate) <= Date.parse(query.endDate)
    },
    {
      error: 'startDate must be before or equal to endDate',
      path: ['startDate'],
    }
  )

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

/**
 * Which question the page answers, reported because the two are otherwise
 * indistinguishable on the wire. The same workspace, window, and filters return
 * a strict subset of the rows on `user` scope that they return on `workspace`
 * scope, and nothing else in the response says which set arrived — a caller
 * auditing a workspace's spend with a user-held credential would silently undercount.
 */
export const v2BillingLogsScopeSchema = z
  .enum(['user', 'workspace'])
  .describe(
    "Whose usage this page reports. `user` contains only the OAuth or personal-key user's events, optionally narrowed by `workspaceId`; it omits other members. `workspace` contains every member's events for the workspace API key's bound workspace."
  )

export const v2ListBillingLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/billing/logs',
  query: v2BillingLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2BillingLogEntrySchema).extend({
      scope: v2BillingLogsScopeSchema,
    }),
  },
})
