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

export const auditLogsQuerySchema = z.object({
  search: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  actorId: z.string().optional(),
  startDate: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: 'Invalid startDate format',
    }),
  endDate: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), {
      message: 'Invalid endDate format',
    }),
  includeDeparted: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  limit: z
    .string()
    .optional()
    .transform((value) => Math.min(Math.max(Number(value) || 50, 1), 100)),
  cursor: z.string().optional(),
})
export type AuditLogsQuery = z.output<typeof auditLogsQuerySchema>

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

const apiResponseWithLimitsSchema = z
  .object({
    data: z.unknown(),
    limits: z.unknown().optional(),
  })
  .passthrough()

export const listAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/audit-logs',
  query: auditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        success: z.literal(true),
        data: z.array(z.unknown()),
        nextCursor: z.string().nullable().optional(),
      })
      .passthrough(),
  },
})

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
