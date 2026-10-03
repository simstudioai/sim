import { z } from 'zod'
import {
  booleanQueryFlagSchema,
  organizationIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1AuditLogParamsSchema,
  v1ListAuditLogsQuerySchema,
} from '@/lib/api/contracts/v1/audit-logs'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2RunWindowBoundSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 audit-logs contracts. These are org-scoped enterprise endpoints. The
 * filters are inherited from v1, with an explicit organization selector added
 * so a caller that already knows its organization id can name it rather than
 * rely on the derivation. The selector stays optional so a caller can reach the
 * resource without an id no API-key surface publishes. The response uses the
 * canonical v2 envelope and drops the v1 `limits` body — usage limits live on
 * their dedicated endpoint.
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
    resourceId: z
      .string()
      .nullable()
      .describe('Affected resource ID. Null for folder events, which identify folders by path.'),
    resourceName: z.string().nullable().describe('Display name of the affected resource.'),
    description: z.string().nullable().describe('Human-readable description of the action.'),
    metadata: z.unknown().describe('Additional JSON details specific to the action.'),
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
      'Filter by resource type. Accepts a comma-separated set; members are trimmed and deduplicated, and member order affects neither the result nor the cursor.'
    ),
    resourceId: v1ListAuditLogsQuerySchema.shape.resourceId.describe(
      'Filter by exact resource identifier.'
    ),
    /**
     * The one v2 query param still declared as a bare `z.string()` rather than
     * the shared identifier schema, so `?workspaceId=` parsed and was forwarded
     * as a real filter — a page of zero rows where every sibling answers 400.
     */
    workspaceId: workspaceIdSchema.optional().describe('Filter to actions in one workspace.'),
    /**
     * The shared run-window bound rather than the v1 `Date.parse` refine, which
     * accepts partial and locale-dependent forms whose meaning varies by
     * runtime. Both bounds are turned into `Date`s before they reach the query,
     * so the strict UTC form is what keeps an unrepresentable value a 400
     * instead of a driver-level 500. `GET /logs` and `GET /workflows/{workflowId}/runs`
     * already share it, and an audit trail is read alongside them.
     */
    startDate: v2RunWindowBoundSchema('startDate').optional(),
    endDate: v2RunWindowBoundSchema('endDate').optional(),
    /**
     * Declared with the shared boolean flag rather than reused from the v1
     * shape: v1 spells it as a `'true'`/`'false'` string enum, and every other
     * v2 boolean query param is a real boolean. The shared schema still accepts
     * both strings, so `?includeDeparted=true` is unchanged for existing
     * callers — it only widens what parses and fixes what the spec advertises.
     */
    includeDeparted: booleanQueryFlagSchema
      .describe('Include actions by users who have left the organization.')
      .optional()
      .default(false),
    ...v2PaginationFields({ description: 'Maximum audit entries to return per page.' }),
    /**
     * Optional, because nothing an API key can reach publishes an organization
     * id: the audit rows themselves carry none, `GET /api/organizations` is
     * session-gated, and the admin organization list needs an admin key. A
     * required-and-undiscoverable param made the whole resource unreachable
     * from a key, so it is derived from the caller the way v1 has always
     * derived it. An account belongs to at most one organization, so the
     * derivation has exactly one candidate; a caller in none is refused with a
     * 403, and one that names an organization it does not belong to is refused
     * with a 403 as well.
     */
    organizationId: organizationIdSchema
      .optional()
      .describe(
        "Organization whose audit trail should be queried. Defaults to the caller's own organization when omitted. A caller that belongs to no organization, or that names one it is not a member of, is refused with a 403."
      ),
    actorEmail: z.email().optional().describe('Filter by actor email address.'),
  })
  .strict()

export const v2AuditLogParamsSchema = v1AuditLogParamsSchema.omit({ id: true }).extend({
  auditLogId: v1AuditLogParamsSchema.shape.id.describe('Audit-log entry identifier.'),
})

export const v2GetAuditLogQuerySchema = z
  .object({
    /** Derived from the caller when omitted — see {@link v2ListAuditLogsQuerySchema}. */
    organizationId: organizationIdSchema
      .optional()
      .describe(
        "Organization whose audit-log entry should be returned. Defaults to the caller's own organization when omitted. A caller that belongs to no organization, or that names one it is not a member of, is refused with a 403."
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
  path: '/api/v2/audit-logs/[auditLogId]',
  params: v2AuditLogParamsSchema,
  query: v2GetAuditLogQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2AuditLogEntrySchema),
  },
})
