import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { INTERNAL_USAGE_LOG_SOURCES } from '@/lib/billing/usage-sources'
import { isValidTimezone } from '@/lib/core/utils/timezone'

/**
 * Organization usage monitoring (enterprise).
 *
 * Everything on the wire is denominated in **credits**, never dollars: the ledger
 * stores dollars and the use cases convert at this boundary, matching every other
 * usage surface in the product.
 */

export const USAGE_WINDOW_PRESETS = [
  'current-period',
  'previous-period',
  '7d',
  '30d',
  'custom',
] as const
export const usageWindowPresetSchema = z.enum(USAGE_WINDOW_PRESETS).default('current-period')
export type UsageWindowPreset = z.output<typeof usageWindowPresetSchema>

export const USAGE_BREAKDOWN_DIMENSIONS = [
  'member',
  'workspace',
  'workflow',
  'model',
  'byok',
  'source',
] as const
export const usageBreakdownDimensionSchema = z.enum(USAGE_BREAKDOWN_DIMENSIONS)
export type UsageBreakdownDimension = z.output<typeof usageBreakdownDimensionSchema>

/**
 * The longest custom range the ledger will scan. Declared on the contract so the
 * picker states the same limit the window resolver enforces, rather than the client
 * discovering it from a rejected request.
 */
export const MAX_CUSTOM_RANGE_DAYS = 92

/**
 * A calendar date the window resolver can trust.
 *
 * `Date.parse` alone accepts `2026-02-30` and rolls it forward, so a request for
 * February silently returned a window starting on March 2 — worse than a rejection,
 * because the response looks authoritative. The round-trip is what makes the check
 * a calendar one: a date that does not survive re-serialization did not exist.
 */
const isoDateSchema = z
  .string()
  .optional()
  .refine(
    (value) => {
      if (!value) return true
      // The `YYYY-MM-DD` prefix is required, not merely checked when present. Letting
      // anything else through on the grounds that `Date.parse` accepted it meant
      // `2026-08` was read as August 1 — a window the caller never asked for, returned
      // as though it had.
      const datePart = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value)?.[1]
      if (!datePart) return false
      // Rolls a nonexistent day forward (`2026-02-30` becomes March 2), so the only
      // way to reject one is to check that it survives the round trip.
      return new Date(`${datePart}T00:00:00.000Z`).toISOString().slice(0, 10) === datePart
    },
    { message: 'Expected a real calendar date such as 2026-08-01' }
  )

/**
 * A page size that treats an empty or absent parameter as omitted.
 *
 * `z.coerce.number()` turns `''` into `0`, which then fails `.min(1)` — so a client
 * that serializes an unset filter as `?limit=` got a 400 instead of the default the
 * schema declares. Explicit numeric values still validate normally.
 */
function usageLimitSchema(max: number, fallback: number) {
  return z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().min(1).max(max).default(fallback)
  )
}

/**
 * Shared by all four contracts so the four surfaces cannot describe different
 * windows — a mismatch here is how the tiles and the event log would disagree.
 */
const organizationUsageWindowQuerySchema = z.object({
  /*
    No `organizationId` here. The organization is the path parameter, and that is the
    one every handler authorizes and reads. Accepting a second copy in the query meant
    a request could name one organization and be answered about another — not an
    authorization hole, since `params.id` is what gets checked, but an API that reads
    as though the query mattered.
  */
  preset: usageWindowPresetSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  /**
   * IANA name; bucket boundaries are the viewer's calendar days.
   *
   * Validated here rather than only at the SQL boundary. `assertValidTimezone` is a
   * hard gate — the value reaches `AT TIME ZONE`, which takes an identifier and not
   * a bound parameter — but it throws a plain `Error`, which surfaced as a 500 for
   * what is an ordinary bad query param. Rejecting it as a contract violation makes
   * it a 400 with a usable message and leaves that gate as the backstop it is.
   */
  timezone: z
    .string()
    .min(1, 'timezone cannot be empty')
    .refine(isValidTimezone, 'Expected an IANA timezone such as America/Los_Angeles')
    .default('UTC'),
})

export const organizationUsageSummaryQuerySchema = organizationUsageWindowQuerySchema
export type OrganizationUsageSummaryQuery = z.input<typeof organizationUsageSummaryQuerySchema>

export const organizationUsageBreakdownQuerySchema = organizationUsageWindowQuerySchema.extend({
  dimension: usageBreakdownDimensionSchema,
  /** Narrows the breakdown to one workspace, for the Workspaces drill-down. */
  workspaceId: workspaceIdSchema.optional(),
  limit: usageLimitSchema(50, 10),
})
export type OrganizationUsageBreakdownQuery = z.input<typeof organizationUsageBreakdownQuerySchema>

/**
 * Ledger sources, as an enum rather than free strings.
 *
 * Two problems this closes. A single selected source arrives on the wire as one
 * scalar, not a one-item array, so an `z.array(...)` alone rejected the commonest
 * filter outright — hence the union and normalization. And an unrecognized value
 * used to survive validation and reach the query as an unchecked cast, where it
 * matched nothing and returned an empty page that looked like "no usage" rather
 * than a bad request.
 */
const usageLogSourceFilterSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.enum(INTERNAL_USAGE_LOG_SOURCES)).max(20))

export const organizationUsageEventsQuerySchema = organizationUsageWindowQuerySchema.extend({
  source: usageLogSourceFilterSchema.optional(),
  limit: usageLimitSchema(100, 50),
  cursor: z.string().min(1).optional(),
})
export type OrganizationUsageEventsQuery = z.input<typeof organizationUsageEventsQuerySchema>

export const organizationUsageExportQuerySchema = organizationUsageEventsQuerySchema.omit({
  limit: true,
  cursor: true,
})
export type OrganizationUsageExportQuery = z.input<typeof organizationUsageExportQuerySchema>

/** Only the headline figure — see `readUsageTotals` for why nothing else lives here. */
const usageTotalsSchema = z.object({
  credits: z.number(),
})

const usageSeriesPointSchema = z.object({
  timestamp: z.string(),
  credits: z.number(),
  events: z.number().int(),
})

export const organizationUsageSummaryResponseSchema = z.object({
  window: z.object({
    start: z.string(),
    end: z.string(),
    source: z.enum(['reporting', 'stripe', 'default', 'range']),
  }),
  bucket: z.enum(['day', 'week', 'month']),
  totals: usageTotalsSchema,
  /** `null` when the prior window is not exactly derivable — no delta beats a wrong one. */
  previousTotals: usageTotalsSchema.nullable(),
  series: z.array(usageSeriesPointSchema),
})
export type OrganizationUsageSummary = z.output<typeof organizationUsageSummaryResponseSchema>

export const organizationUsageBreakdownRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  credits: z.number(),
  events: z.number().int(),
  /** 0..1 of the window total, not of the visible rows. */
  share: z.number().min(0).max(1),
  /** Model dimensions only — resolved server-side so the client needs no model registry. */
  providerId: z.string().optional(),
  /** Model dimensions only; BYOK rows carry no cost, so this is their only usage figure. */
  tokens: z.number().int().optional(),
})
export type OrganizationUsageBreakdownRow = z.output<typeof organizationUsageBreakdownRowSchema>

export const organizationUsageBreakdownResponseSchema = z.object({
  dimension: usageBreakdownDimensionSchema,
  rows: z.array(organizationUsageBreakdownRowSchema),
  /** The truncated tail, so the visible rows plus this reconcile to `totalCredits`. */
  other: z.object({
    credits: z.number(),
    events: z.number().int(),
    rowCount: z.number().int(),
    /** Tokens for the omitted rows, so the token-denominated BYOK tab still adds up. */
    tokens: z.number().int().nonnegative(),
  }),
  totalCredits: z.number(),
})
export type OrganizationUsageBreakdown = z.output<typeof organizationUsageBreakdownResponseSchema>

export const organizationUsageEventSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  source: z.string(),
  description: z.string(),
  workflowName: z.string().nullable(),
  credits: z.number(),
  hasCost: z.boolean(),
})
export type OrganizationUsageEvent = z.output<typeof organizationUsageEventSchema>

export const organizationUsageEventsResponseSchema = z.object({
  events: z.array(organizationUsageEventSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
})
export type OrganizationUsageEventPage = z.output<typeof organizationUsageEventsResponseSchema>

export const getOrganizationUsageSummaryContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/summary',
  params: z.object({ id: organizationIdSchema }),
  query: organizationUsageSummaryQuerySchema,
  response: { mode: 'json', schema: organizationUsageSummaryResponseSchema },
})

export const getOrganizationUsageBreakdownContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/breakdown',
  params: z.object({ id: organizationIdSchema }),
  query: organizationUsageBreakdownQuerySchema,
  response: { mode: 'json', schema: organizationUsageBreakdownResponseSchema },
})

export const listOrganizationUsageEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/events',
  params: z.object({ id: organizationIdSchema }),
  query: organizationUsageEventsQuerySchema,
  response: { mode: 'json', schema: organizationUsageEventsResponseSchema },
})

/** `mode: 'text'` — a CSV body has no JSON schema to validate. */
export const exportOrganizationUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/usage/export',
  params: z.object({ id: organizationIdSchema }),
  query: organizationUsageExportQuerySchema,
  response: { mode: 'text' },
})
