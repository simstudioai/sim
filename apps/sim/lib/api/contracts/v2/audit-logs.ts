import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1AuditLogParamsSchema,
  v1ListAuditLogsQuerySchema,
} from '@/lib/api/contracts/v1/audit-logs'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 audit-logs contracts. These are org-scoped enterprise endpoints. The
 * filters are inherited from v1, with an explicit organization selector added
 * so callers never depend on whichever membership happens to be returned
 * first. The response uses the canonical v2 envelope and drops the v1 `limits`
 * body — usage limits live on their dedicated endpoint.
 */

/**
 * Public enterprise audit-log entry. Mirrors `formatAuditLogEntry` in
 * `app/api/v1/audit-logs/format.ts` and the v1 `v1AuditLogEntrySchema`;
 * `ipAddress`/`userAgent` are intentionally excluded for privacy. `metadata` is
 * genuinely arbitrary per-action JSON.
 */
export const v2AuditLogEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.email().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
})

export type V2AuditLogEntry = z.output<typeof v2AuditLogEntrySchema>

export const v2ListAuditLogsQuerySchema = v1ListAuditLogsQuerySchema
  .omit({ actorId: true })
  .extend({ organizationId: organizationIdSchema, actorEmail: z.email().optional() })
  .strict()

export const v2GetAuditLogQuerySchema = z.object({ organizationId: organizationIdSchema }).strict()

export const v2ListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/audit-logs',
  query: v2ListAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2AuditLogEntrySchema),
  },
})

export const v2GetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  query: v2GetAuditLogQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2AuditLogEntrySchema),
  },
})
