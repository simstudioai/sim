/**
 * PATCH /api/v1/admin/organizations/[id]/data-retention
 *
 * Set an organization's data-retention settings without going through the
 * settings UI, so a self-hosted deployment can provision retention windows and
 * PII redaction rules from its own configuration management.
 *
 * Retention windows only take effect once the cleanup pass is enabled — set
 * `DATA_RETENTION_ENABLED` (or `ENTERPRISE_ENABLED`) when billing is off.
 *
 * Body: any subset of `logRetentionHours`, `softDeleteRetentionHours`,
 * `taskCleanupHours`, `piiRedaction`, `retentionOverrides`. Omitted keys keep
 * their current value; `null` means "forever" for an hours field.
 *
 * Response: AdminSingleResponse<{ success, organizationId }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { DataRetentionSettings } from '@sim/db/schema'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { adminV1UpdateOrganizationDataRetentionContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { getPiiRedactionDenialReason } from '@/lib/billing/retention'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminOrganizationDataRetentionAPI')

interface RouteParams {
  id: string
}

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminV1UpdateOrganizationDataRetentionContract,
      request,
      context,
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const body = parsed.data.body

    try {
      const [existing] = await db
        .select({
          name: organization.name,
          dataRetentionSettings: organization.dataRetentionSettings,
        })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!existing) {
        return notFoundResponse('Organization')
      }

      const merged: DataRetentionSettings = { ...(existing.dataRetentionSettings ?? {}) }
      if (body.logRetentionHours !== undefined) merged.logRetentionHours = body.logRetentionHours
      if (body.softDeleteRetentionHours !== undefined) {
        merged.softDeleteRetentionHours = body.softDeleteRetentionHours
      }
      if (body.taskCleanupHours !== undefined) merged.taskCleanupHours = body.taskCleanupHours

      if (body.piiRedaction !== undefined) {
        /**
         * The same gate the settings UI applies. An admin key authenticates an
         * operator, not an entitlement — without this check it would be a way
         * to switch on PII redaction that the product does not offer this
         * organization.
         */
        const [piiRedactionEnabled, piiGranularRedactionEnabled] = await Promise.all([
          isFeatureEnabled('pii-redaction'),
          isFeatureEnabled('pii-granular-redaction'),
        ])
        const denialReason = getPiiRedactionDenialReason({
          current: existing.dataRetentionSettings?.piiRedaction,
          incoming: body.piiRedaction,
          piiRedactionEnabled,
          piiGranularRedactionEnabled,
        })
        if (denialReason) return forbiddenResponse(denialReason)

        merged.piiRedaction = body.piiRedaction
      }

      if (body.retentionOverrides !== undefined) {
        merged.retentionOverrides = body.retentionOverrides
      }

      await db
        .update(organization)
        .set({ dataRetentionSettings: merged, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))

      logger.info(`Admin API: Updated data retention for organization ${organizationId}`, {
        fields: Object.keys(body),
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: existing.name,
        description: `Admin API updated data retention for "${existing.name}"`,
        metadata: { fields: Object.keys(body) },
        request,
      })

      return singleResponse({ success: true as const, organizationId })
    } catch (error) {
      logger.error('Admin API: Failed to update data retention', { error, organizationId })
      return internalErrorResponse('Failed to update data retention')
    }
  })
)
