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
export const usageBreakdownDimensionSchema = z
  .enum(USAGE_BREAKDOWN_DIMENSIONS)
  .describe('Usage grouping dimension.')
export type UsageBreakdownDimension = z.output<typeof usageBreakdownDimensionSchema>

/**
 * The longest custom range the ledger will scan. Declared on the contract so the
 * picker states the same limit the window resolver enforces, rather than the client
 * discovering it from a rejected request.
 */
export const MAX_CUSTOM_RANGE_DAYS = 92

export const ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT = 50
export const ORGANIZATION_USAGE_BREAKDOWN_MAX_LIMIT = 100

/**
 * A bare `YYYY-MM-DD` calendar date, and nothing else.
 *
 * `z.iso.date()` is a calendar check rather than a format one — it refuses `2026-02-30` and a
 * non-leap `2026-02-29`, so February is never answered about March — and it is pure pattern
 * matching, so no input can make it throw. Both matter: a hand-rolled round trip through
 * `toISOString` threw on an out-of-range month, and inside a refinement that escapes validation
 * entirely and answers a malformed query string with a 500.
 *
 * Absent is allowed and empty is not. A missing bound is a real state — the picker clears the
 * param rather than blanking it, and the resolver falls back to the current period — while an
 * explicit `?start-date=` is a malformed request that must not silently answer about a different
 * window. Deliberately unlike `usageLimitSchema`, which coerces `''` to its declared default;
 * these bounds have none, so omitting one changes which period you get.
 */
const isoDateSchema = z.iso
  .date({ error: 'Expected a calendar date in YYYY-MM-DD form, such as 2026-08-01' })
  .optional()

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
    .default('UTC')
    .describe('IANA timezone for calendar boundaries; defaults to UTC.'),
})

/**
 * Narrows a read to one workspace, for the Workspaces drill-down.
 *
 * Declared once and spread into both query schemas: the drill-down draws its chart
 * from the summary and its lists from the breakdown, so a workspace filter either
 * surface could express alone is one the two could disagree about.
 */
const usageWorkspaceScopeShape = {
  workspaceId: workspaceIdSchema
    .optional()
    .describe('Restrict usage to one workspace owned by the organization.'),
} as const

export const organizationUsageSummaryQuerySchema =
  organizationUsageWindowQuerySchema.extend(usageWorkspaceScopeShape)
export type OrganizationUsageSummaryQuery = z.input<typeof organizationUsageSummaryQuerySchema>

export const organizationUsageBreakdownQuerySchema = organizationUsageWindowQuerySchema.extend({
  ...usageWorkspaceScopeShape,
  dimension: usageBreakdownDimensionSchema,
  limit: usageLimitSchema(
    ORGANIZATION_USAGE_BREAKDOWN_MAX_LIMIT,
    ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT
  ),
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
  credits: z.number().describe('Whole credits attributed to this total or group.'),
})

const usageSeriesPointSchema = z.object({
  timestamp: z
    .string()
    .describe(
      'Start of this calendar bucket as a local wall-clock timestamp in the requested timezone.'
    ),
  credits: z.number().describe('Whole credits attributed to this total or group.'),
  events: z.number().int().describe('Number of usage events.'),
})

export const organizationUsageSummaryResponseSchema = z.object({
  window: z
    .object({
      start: z.string().describe('Inclusive reporting-window start as an ISO 8601 UTC timestamp.'),
      end: z.string().describe('Exclusive reporting-window end as an ISO 8601 UTC timestamp.'),
      source: z
        .enum(['reporting', 'stripe', 'default', 'range'])
        .describe('How the reporting window was resolved.'),
    })
    .describe('Resolved reporting window.'),
  bucket: z.enum(['day', 'week', 'month']).describe('Calendar granularity of the usage series.'),
  totals: usageTotalsSchema.describe('Total usage for the selected window.'),
  /** `null` when the prior window is not exactly derivable — no delta beats a wrong one. */
  previousTotals: usageTotalsSchema
    .nullable()
    .describe('Exact previous-period total, or null when no exact comparison is available.'),
  series: z
    .array(usageSeriesPointSchema)
    .describe('Chronological usage buckets, including buckets with no usage.'),
})
export type OrganizationUsageSummary = z.output<typeof organizationUsageSummaryResponseSchema>

export const organizationUsageBreakdownRowSchema = z.object({
  id: z.string().describe('Group identifier; an empty ID represents unattributed usage.'),
  label: z.string().describe('Display label for the usage group.'),
  credits: z.number().describe('Whole credits attributed to this total or group.'),
  events: z.number().int().describe('Number of usage events.'),
  /** 0..1 of the window total, not of the visible rows. */
  share: z
    .number()
    .min(0)
    .max(1)
    .describe('Fraction of total cost, or total tokens for BYOK, between zero and one.'),
  /** Model dimensions only — resolved server-side so the client needs no model registry. */
  providerId: z.string().optional().describe('Model provider identifier, when applicable.'),
  /** Model dimensions only; BYOK rows carry no cost, so this is their only usage figure. */
  tokens: z.number().int().optional().describe('Input and output tokens for model or BYOK groups.'),
})
export type OrganizationUsageBreakdownRow = z.output<typeof organizationUsageBreakdownRowSchema>

export const organizationUsageBreakdownResponseSchema = z.object({
  dimension: usageBreakdownDimensionSchema,
  rows: z
    .array(organizationUsageBreakdownRowSchema)
    .describe('Top usage groups ordered by cost, or tokens for BYOK.'),
  /** The truncated tail, so the visible rows plus this reconcile to `totalCredits`. */
  other: z
    .object({
      credits: z.number().describe('Whole credits attributed to this total or group.'),
      events: z.number().int().describe('Number of usage events.'),
      rowCount: z.number().int().describe('Number of groups omitted from rows.'),
      /** Tokens for the omitted rows, so the token-denominated BYOK tab still adds up. */
      tokens: z
        .number()
        .int()
        .nonnegative()
        .describe('Input and output tokens attributed to omitted groups.'),
    })
    .describe('Combined usage for groups omitted by the limit.'),
  totalCredits: z
    .number()
    .describe(
      'Whole credits represented by this breakdown; workflow includes only workflow-attributed usage.'
    ),
})
export type OrganizationUsageBreakdown = z.output<typeof organizationUsageBreakdownResponseSchema>

export const organizationUsageEventSchema = z.object({
  id: z.string().describe('Unique usage-ledger event identifier.'),
  createdAt: z.string(),
  source: z.string(),
  description: z.string(),
  workflowName: z.string().nullable(),
  credits: z.number().describe('Whole credits attributed to this total or group.'),
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
