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
export const v2AuditLogEntrySchema = z
  .object({
    id: z
      .string()
      .describe('Unique audit-log entry identifier.')
      .meta({ examples: ['audit_2c3d4e5f6g'] }),
    workspaceId: z
      .string()
      .nullable()
      .describe('Workspace where the action occurred, or null for organization-level actions.'),
    actorName: z
      .string()
      .nullable()
      .describe('Display name of the person who performed the action.'),
    actorEmail: z
      .email()
      .nullable()
      .describe('Email address of the person who performed the action.'),
    action: z
      .string()
      .describe('Action that was performed.')
      .meta({ examples: ['file.uploaded'] }),
    resourceType: z
      .string()
      .describe('Type of resource affected by the action.')
      .meta({ examples: ['file'] }),
    resourceId: z.string().nullable().describe('Identifier of the affected resource.'),
    resourceName: z.string().nullable().describe('Display name of the affected resource.'),
    description: z.string().nullable().describe('Human-readable description of the action.'),
    metadata: z.unknown().describe('Arbitrary per-action JSON metadata.'),
    createdAt: z
      .string()
      .describe('ISO 8601 timestamp when the action occurred.')
      .meta({ format: 'date-time', examples: ['2026-01-15T10:30:00Z'] }),
  })
  .meta({
    id: 'V2AuditLogEntry',
    title: 'Audit-log entry',
    description: 'Public enterprise audit-log entry with privacy-sensitive request data omitted.',
  })

export type V2AuditLogEntry = z.output<typeof v2AuditLogEntrySchema>

export const v2ListAuditLogsQuerySchema = v1ListAuditLogsQuerySchema
  .omit({ actorId: true })
  .extend({
    action: v1ListAuditLogsQuerySchema.shape.action.describe('Filter by exact action name.'),
    resourceType: v1ListAuditLogsQuerySchema.shape.resourceType.describe(
      'Filter by exact resource type.'
    ),
    resourceId: v1ListAuditLogsQuerySchema.shape.resourceId.describe(
      'Filter by exact resource identifier.'
    ),
    workspaceId: v1ListAuditLogsQuerySchema.shape.workspaceId.describe(
      'Filter to actions in one workspace.'
    ),
    startDate: v1ListAuditLogsQuerySchema.shape.startDate.describe(
      'Inclusive ISO 8601 start timestamp.'
    ),
    endDate: v1ListAuditLogsQuerySchema.shape.endDate.describe('Inclusive ISO 8601 end timestamp.'),
    includeDeparted: v1ListAuditLogsQuerySchema.shape.includeDeparted.describe(
      'Include actions by users who have left the organization.'
    ),
    limit: v1ListAuditLogsQuerySchema.shape.limit.describe(
      'Maximum entries per page, from 1 to 100.'
    ),
    cursor: v1ListAuditLogsQuerySchema.shape.cursor.describe(
      'Opaque cursor returned by the previous page.'
    ),
    organizationId: organizationIdSchema.describe(
      'Organization whose audit trail should be queried.'
    ),
    actorEmail: z.email().optional().describe('Filter by actor email address.'),
  })
  .strict()

export const v2AuditLogParamsSchema = v1AuditLogParamsSchema.extend({
  id: v1AuditLogParamsSchema.shape.id.describe('Audit-log entry identifier.'),
})

export const v2GetAuditLogQuerySchema = z
  .object({
    organizationId: organizationIdSchema.describe(
      'Organization whose audit-log entry should be returned.'
    ),
  })
  .strict()

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
  params: v2AuditLogParamsSchema,
  query: v2GetAuditLogQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2AuditLogEntrySchema),
  },
})
