import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Reads through the same-origin mothership admin proxy (`/api/admin/mothership`). The proxy forwards
 * the upstream JSON verbatim, so each upstream endpoint it serves has its own contract here, and the
 * client checks the shape once per fetch rather than on every render.
 */
const ADMIN_MOTHERSHIP_PATH = '/api/admin/mothership'

const mothershipAdminEnvSchema = z.enum(['default', 'dev', 'staging', 'prod'])
export type MothershipAdminEnv = z.output<typeof mothershipAdminEnvSchema>

const instantSchema = z.string().refine((date) => Number.isFinite(Date.parse(date)))

function proxyQuery<Endpoint extends string>(endpoint: Endpoint) {
  return z.object({
    env: mothershipAdminEnvSchema,
    endpoint: z.literal(endpoint).default(endpoint),
  })
}

const reportingPeriodBodySchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  userId: z.string().min(1).optional(),
})

const mothershipUserBreakdownSchema = z.object({
  total_requests: z.number(),
  total_users: z.number(),
  users: z.array(
    z.object({
      user_id: z.string(),
      request_count: z.number(),
      total_cost: z.number(),
      last_request: instantSchema.nullish(),
    })
  ),
})

const mothershipRequestListSchema = z.object({
  count: z.number(),
  requests: z.array(
    z.object({
      request_id: z.string(),
      model: z.string().nullish(),
      duration_ms: z.number().nullish(),
      billed_total_cost: z.number().nullish(),
      tool_call_count: z.number().nullish(),
      error: z.boolean().nullish(),
      aborted: z.boolean().nullish(),
      created_at: instantSchema,
    })
  ),
})

const mothershipLicenseListSchema = z.object({
  licenses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      count: z.number(),
      expiration_date: instantSchema.nullish(),
      created_at: instantSchema,
    })
  ),
})

export const mothershipUserBreakdownContract = defineRouteContract({
  method: 'POST',
  path: ADMIN_MOTHERSHIP_PATH,
  query: proxyQuery('user-breakdown'),
  body: reportingPeriodBodySchema,
  response: { mode: 'json', schema: mothershipUserBreakdownSchema },
})

export const mothershipRequestListContract = defineRouteContract({
  method: 'POST',
  path: ADMIN_MOTHERSHIP_PATH,
  query: proxyQuery('requests'),
  body: reportingPeriodBodySchema,
  response: { mode: 'json', schema: mothershipRequestListSchema },
})

export const mothershipLicenseListContract = defineRouteContract({
  method: 'GET',
  path: ADMIN_MOTHERSHIP_PATH,
  query: proxyQuery('licenses'),
  response: { mode: 'json', schema: mothershipLicenseListSchema },
})

export const generateMothershipLicenseContract = defineRouteContract({
  method: 'POST',
  path: ADMIN_MOTHERSHIP_PATH,
  query: proxyQuery('licenses/generate'),
  body: z.object({
    name: z.string().min(1),
    approvalReference: z.string().min(1),
    expirationDate: z.string().min(1).optional(),
  }),
  response: { mode: 'json', schema: z.object({ license_key: z.string() }) },
})
