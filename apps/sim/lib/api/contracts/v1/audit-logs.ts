import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  error: 'Invalid date format. Use ISO 8601.',
})

const optionalQueryString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional()
)

export const v1AuditLogParamsSchema = z.object({
  id: z.string().min(1),
})

export const v1ListAuditLogsQuerySchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  workspaceId: z.string().optional(),
  actorId: z.string().optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  includeDeparted: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional()
    .default(false),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

export type V1ListAuditLogsQuery = z.output<typeof v1ListAuditLogsQuerySchema>
export type V1AuditLogParams = z.output<typeof v1AuditLogParamsSchema>

export const v1AdminAuditLogsQuerySchema = z.object({
  action: optionalQueryString,
  resourceType: optionalQueryString,
  resourceId: optionalQueryString,
  workspaceId: optionalQueryString,
  actorId: optionalQueryString,
  actorEmail: optionalQueryString,
  startDate: z.preprocess((value) => (value === '' ? undefined : value), isoDateString.optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), isoDateString.optional()),
})

/**
 * Generic wrapper used by v1 admin audit-log responses. The `data` and
 * `limits` halves are intentionally `z.unknown()` because this proxy returns
 * provider-shaped payloads that vary per route family; tightening here would
 * require a discriminated union per route, which is tracked as a follow-up.
 *
 * boundary-policy: this is the "validates nothing" alias form that the audit
 * script's `untyped-response` regex doesn't currently catch. Treat any new
 * wrapper of this shape the same way and either annotate at the contract use
 * site with `// untyped-response: <reason>` or replace with a concrete schema.
 */
const apiResponseWithLimitsSchema = z
  .object({
    data: z.unknown(),
    limits: z.unknown().optional(),
  })
  .passthrough()

export const v1ListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/audit-logs',
  query: v1ListAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: apiResponseWithLimitsSchema,
  },
})

export const v1GetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  response: {
    mode: 'json',
    schema: apiResponseWithLimitsSchema,
  },
})

export const v1AdminListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/audit-logs',
  query: v1AdminAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: apiResponseWithLimitsSchema,
  },
})

export const v1AdminGetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  response: {
    mode: 'json',
    schema: apiResponseWithLimitsSchema,
  },
})
