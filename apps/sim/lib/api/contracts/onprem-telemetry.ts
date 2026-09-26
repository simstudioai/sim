import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Wire format between a self-hosted deployment (sender) and the Sim instance
 * that collects its usage (receiver). Both sides import this file, so the
 * receiver rejects anything the sender could not have produced. Bump the
 * version when a field changes meaning; add optional fields without bumping.
 */
export const ONPREM_TELEMETRY_SCHEMA_VERSION = 1

/** A sender may re-send up to 90 trailing days; the receiver caps the same. */
export const ONPREM_TELEMETRY_MAX_BUCKETS = 90

const nonNegativeInt = z.number().int().min(0)
const nonNegative = z.number().min(0)
const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: 'must be an ISO 8601 date' })

/** Credits and event count for one (source, category) pair inside a day. */
export const onPremUsageSourceLineSchema = z.object({
  source: z.string().min(1),
  category: z.string().min(1),
  events: nonNegativeInt,
  credits: nonNegative,
})

/**
 * Token volume for one model inside a day. `credits` is nonzero only when the
 * model ran on a Sim hosted key; BYOK usage reports tokens with zero credits.
 */
export const onPremUsageModelLineSchema = z.object({
  model: z.string().min(1),
  events: nonNegativeInt,
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  credits: nonNegative,
})

/** One UTC calendar day of usage. No identifiers, inputs or outputs cross the wire. */
export const onPremUsageBucketSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  workflowExecutions: nonNegativeInt,
  workflowExecutionsFailed: nonNegativeInt,
  workflowDurationMs: nonNegativeInt,
  /** 200 × the ledger dollar sum for the day (see `lib/billing/credits/conversion.ts`). */
  credits: nonNegative,
  inputTokens: nonNegativeInt,
  outputTokens: nonNegativeInt,
  sources: z.array(onPremUsageSourceLineSchema),
  models: z.array(onPremUsageModelLineSchema),
})

export const onPremUsageReportBodySchema = z.object({
  schemaVersion: z.literal(ONPREM_TELEMETRY_SCHEMA_VERSION),
  deploymentId: z.string().min(1),
  reportedAt: isoDate,
  buckets: z.array(onPremUsageBucketSchema).max(ONPREM_TELEMETRY_MAX_BUCKETS),
})

export const onPremUsageReportResponseSchema = z.object({
  accepted: nonNegativeInt,
})

export const onPremUsageReportContract = defineRouteContract({
  method: 'POST',
  path: '/api/onprem-telemetry/report',
  body: onPremUsageReportBodySchema,
  response: {
    mode: 'json',
    schema: onPremUsageReportResponseSchema,
  },
})

export type OnPremUsageSourceLine = z.infer<typeof onPremUsageSourceLineSchema>
export type OnPremUsageModelLine = z.infer<typeof onPremUsageModelLineSchema>
export type OnPremUsageBucket = z.infer<typeof onPremUsageBucketSchema>
export type OnPremUsageReportBody = z.infer<typeof onPremUsageReportBodySchema>
