import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1AuditLogParamsSchema,
  v1ListAuditLogsQuerySchema,
} from '@/lib/api/contracts/v1/audit-logs'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 audit-logs contracts. These are org-scoped enterprise endpoints. The
 * request schemas are reused verbatim from v1 (the query/param shape is
 * unchanged); only the response envelope is upgraded to the canonical v2
 * shapes. The v1 `limits` body is dropped — usage limits live on the dedicated
 * usage endpoint, not inlined into every response.
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

export type V2AuditLogEntry = z.output<typeof v2AuditLogEntrySchema>

export const v2ListAuditLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/audit-logs',
  query: v1ListAuditLogsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2AuditLogEntrySchema),
  },
})

export const v2GetAuditLogContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/audit-logs/[id]',
  params: v1AuditLogParamsSchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2AuditLogEntrySchema),
  },
})
