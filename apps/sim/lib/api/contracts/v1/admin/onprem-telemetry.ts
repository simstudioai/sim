import { z } from 'zod'
import {
  onPremUsageModelLineSchema,
  onPremUsageSourceLineSchema,
} from '@/lib/api/contracts/onprem-telemetry'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1IdParamsSchema,
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
  lastQueryValue,
} from '@/lib/api/contracts/v1/admin/shared'

const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: 'must be an ISO 8601 date' })

/** Operator-chosen slug; doubles as the value a deployment sets in `ONPREM_TELEMETRY_DEPLOYMENT_ID`. */
export const adminV1OnPremDeploymentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, {
  error: 'id must be 2-64 lowercase letters, digits or hyphens, starting with a letter or digit',
})

export const adminV1OnPremRateSchema = z.object({
  id: z.string(),
  usdPerCredit: z.number(),
  effectiveFrom: z.string(),
  createdAt: z.string(),
})

export const adminV1OnPremDeploymentSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The rate that applies to a period starting now; null until a rate is set. */
  currentRate: adminV1OnPremRateSchema.nullable(),
  lastReportedAt: z.string().nullable(),
})

export const adminV1CreateOnPremDeploymentBodySchema = z.object({
  id: adminV1OnPremDeploymentIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  /** Optional initial rate, effective immediately. */
  usdPerCredit: z.number().positive().max(1000).optional(),
})

/** The API key is returned exactly once, here; only its hash is stored. */
export const adminV1CreateOnPremDeploymentResultSchema = adminV1OnPremDeploymentSchema.extend({
  apiKey: z.string(),
})

export const adminV1CreateOnPremRateBodySchema = z.object({
  usdPerCredit: z.number().positive().max(1000),
  /** Defaults to now. An earlier instant backdates the rate (see lib/onprem-telemetry/rates.ts). */
  effectiveFrom: isoDateSchema.optional(),
})

export const adminV1OnPremRatesResultSchema = z.object({
  rates: z.array(adminV1OnPremRateSchema),
})

export const adminV1OnPremUsageQuerySchema = z.object({
  /** Inclusive; defaults to 30 days before `to`. */
  from: z.preprocess(lastQueryValue, isoDateSchema.optional()),
  /** Exclusive; defaults to the start of tomorrow (UTC). */
  to: z.preprocess(lastQueryValue, isoDateSchema.optional()),
})

export const adminV1OnPremUsageRowSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  workflowExecutions: z.number(),
  workflowExecutionsFailed: z.number(),
  workflowDurationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  credits: z.number(),
  /** The rate applied to this row, or null when no rate covered `periodStart`. */
  rate: adminV1OnPremRateSchema.nullable(),
  /** `credits × rate.usdPerCredit`, or null when `rate` is null. */
  usd: z.number().nullable(),
  sources: z.array(onPremUsageSourceLineSchema),
  models: z.array(onPremUsageModelLineSchema),
  reportedAt: z.string(),
  receivedAt: z.string(),
})

export const adminV1OnPremUsageResultSchema = z.object({
  deployment: adminV1OnPremDeploymentSchema,
  from: z.string(),
  to: z.string(),
  rows: z.array(adminV1OnPremUsageRowSchema),
  totals: z.object({
    workflowExecutions: z.number(),
    workflowExecutionsFailed: z.number(),
    workflowDurationMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    credits: z.number(),
    /** Dollars across rows that had a rate. */
    usd: z.number(),
    /** Credits in rows no rate covered — nonzero means `usd` understates the period. */
    unvaluedCredits: z.number(),
  }),
})

export const adminV1ListOnPremDeploymentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/onprem-telemetry/deployments',
  query: adminV1PaginationQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1OnPremDeploymentSchema),
  },
})

export const adminV1CreateOnPremDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/onprem-telemetry/deployments',
  body: adminV1CreateOnPremDeploymentBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1CreateOnPremDeploymentResultSchema),
  },
})

export const adminV1ListOnPremRatesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/onprem-telemetry/deployments/[id]/rates',
  params: adminV1IdParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OnPremRatesResultSchema),
  },
})

export const adminV1CreateOnPremRateContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/admin/onprem-telemetry/deployments/[id]/rates',
  params: adminV1IdParamsSchema,
  body: adminV1CreateOnPremRateBodySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OnPremRateSchema),
  },
})

export const adminV1GetOnPremUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/onprem-telemetry/deployments/[id]/usage',
  params: adminV1IdParamsSchema,
  query: adminV1OnPremUsageQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1OnPremUsageResultSchema),
  },
})

export type AdminV1OnPremDeployment = z.infer<typeof adminV1OnPremDeploymentSchema>
export type AdminV1OnPremRate = z.infer<typeof adminV1OnPremRateSchema>
export type AdminV1OnPremUsageRow = z.infer<typeof adminV1OnPremUsageRowSchema>
export type AdminV1ListOnPremDeploymentsResponse = ContractJsonResponse<
  typeof adminV1ListOnPremDeploymentsContract
>
export type AdminV1CreateOnPremDeploymentResponse = ContractJsonResponse<
  typeof adminV1CreateOnPremDeploymentContract
>
export type AdminV1GetOnPremUsageResponse = ContractJsonResponse<
  typeof adminV1GetOnPremUsageContract
>
