import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  adminV1ListResponseSchema,
  adminV1PaginationQuerySchema,
  adminV1SingleResponseSchema,
} from '@/lib/api/contracts/v1/admin/shared'
import { v1UserLimitsSchema } from '@/lib/api/contracts/v1/shared'

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
  ...adminV1PaginationQuerySchema.shape,
})

/**
 * Public enterprise audit-log entry. Mirrors `formatAuditLogEntry` in
 * `app/api/v1/audit-logs/format.ts`; `ipAddress`/`userAgent` are intentionally
 * excluded for privacy. `metadata` is genuinely arbitrary per-action JSON.
 */
const v1AuditLogEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
})

/**
 * Admin audit-log entry. Mirrors `toAdminAuditLog` in `app/api/v1/admin/types.ts`,
 * which additionally exposes `ipAddress`/`userAgent`.
 */
const adminV1AuditLogEntrySchema = v1AuditLogEntrySchema.extend({
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
})

const v1ListAuditLogsResponseSchema = z.object({
  data: z.array(v1AuditLogEntrySchema),
  nextCursor: z.string().optional(),
  limits: v1UserLimitsSchema,
})

const v1GetAuditLogResponseSchema = z.object({
  data: v1AuditLogEntrySchema,
  limits: v1UserLimitsSchema,
})

export type V1AuditLogEntry = z.output<typeof v1AuditLogEntrySchema>
export type AdminV1AuditLogEntry = z.output<typeof adminV1AuditLogEntrySchema>

export const v1ListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/audit-logs',
  query: v1ListAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v1ListAuditLogsResponseSchema,
  },
})

export const v1GetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  response: {
    mode: 'json',
    schema: v1GetAuditLogResponseSchema,
  },
})

export const v1AdminListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/audit-logs',
  query: v1AdminAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: adminV1ListResponseSchema(adminV1AuditLogEntrySchema),
  },
})

export const v1AdminGetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/admin/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  response: {
    mode: 'json',
    schema: adminV1SingleResponseSchema(adminV1AuditLogEntrySchema),
  },
})
