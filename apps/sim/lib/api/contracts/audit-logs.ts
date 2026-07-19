import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const auditLogsQuerySchema = z.object({
  organizationId: organizationIdSchema,
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

export const enterpriseAuditLogEntrySchema = z.object({
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

export type EnterpriseAuditLogEntry = z.output<typeof enterpriseAuditLogEntrySchema>

export const listAuditLogsResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(enterpriseAuditLogEntrySchema),
  nextCursor: z.string().optional(),
})

export type AuditLogPage = z.output<typeof listAuditLogsResponseSchema>

export const listAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/audit-logs',
  query: auditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: listAuditLogsResponseSchema,
  },
})

export const exportAuditLogsQuerySchema = auditLogsQuerySchema.omit({ limit: true, cursor: true })
export type ExportAuditLogsQuery = z.output<typeof exportAuditLogsQuerySchema>

/**
 * CSV download of every audit log matching the filter (no pagination). `mode:
 * 'text'` because a CSV response has no JSON schema to validate; the client
 * triggers this via `fetch` + blob (not `requestJson`), so there's no
 * response shape for a consumer to type.
 */
export const exportAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/audit-logs/export',
  query: exportAuditLogsQuerySchema,
  response: {
    mode: 'text',
  },
})
