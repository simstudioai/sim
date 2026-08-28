import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { INTERNAL_USAGE_LOG_SOURCES } from '@/lib/billing/usage-sources'

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

const isoDateSchema = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
    message: 'Expected an ISO date such as 2026-08-01',
  })

/**
 * Shared by all four contracts so the four surfaces cannot describe different
 * windows — a mismatch here is how the tiles and the event log would disagree.
 */
const organizationUsageWindowQuerySchema = z.object({
  organizationId: organizationIdSchema,
  preset: usageWindowPresetSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  /** IANA name; bucket boundaries are the viewer's calendar days. */
  timezone: z.string().min(1, 'timezone cannot be empty').default('UTC'),
})

export const organizationUsageSummaryQuerySchema = organizationUsageWindowQuerySchema
export type OrganizationUsageSummaryQuery = z.input<typeof organizationUsageSummaryQuerySchema>

export const organizationUsageBreakdownQuerySchema = organizationUsageWindowQuerySchema.extend({
  dimension: usageBreakdownDimensionSchema,
  /** Narrows the breakdown to one workspace, for the Workspaces drill-down. */
  workspaceId: workspaceIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
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
  limit: z.coerce.number().int().min(1).max(100).default(50),
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
