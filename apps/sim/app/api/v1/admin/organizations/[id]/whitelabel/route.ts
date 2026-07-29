/**
 * PATCH /api/v1/admin/organizations/[id]/whitelabel
 *
 * Set an organization's whitelabel settings without going through the settings
 * UI, so a self-hosted deployment can provision branding from its own
 * configuration management.
 *
 * Body: partial whitelabel settings; provided keys are merged over the current
 * value and an explicit `null` clears a key.
 *
 * Response: AdminSingleResponse<{ success, organizationId }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { adminV1UpdateOrganizationWhitelabelContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { isBillingEnabled, isWhitelabelingEnabled } from '@/lib/core/config/env-flags'
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

const logger = createLogger('AdminOrganizationWhitelabelAPI')

interface RouteParams {
  id: string
}

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminV1UpdateOrganizationWhitelabelContract,
      request,
      context,
      {
        validationErrorResponse: adminValidationErrorResponse,
        invalidJsonResponse: adminInvalidJsonResponse,
      }
    )
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const incoming = parsed.data.body

    try {
      const [existing] = await db
        .select({ name: organization.name, whitelabelSettings: organization.whitelabelSettings })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!existing) {
        return notFoundResponse('Organization')
      }

      /**
       * Same entitlement gate the settings UI applies. An admin key
       * authenticates an operator, not an entitlement, so without this it would
       * be a way to set branding the product has not granted this organization.
       */
      const entitled = await isOrganizationFeatureEntitled(organizationId, isWhitelabelingEnabled)
      if (!entitled) {
        return forbiddenResponse(
          isBillingEnabled
            ? 'Whitelabeling is available on Enterprise plans only'
            : 'Whitelabeling is disabled. Set ENTERPRISE_ENABLED or WHITELABELING_ENABLED to enable it.'
        )
      }

      const merged: OrganizationWhitelabelSettings = { ...(existing.whitelabelSettings ?? {}) }
      for (const key of Object.keys(incoming) as Array<keyof typeof incoming>) {
        const value = incoming[key]
        if (value === null || value === undefined) {
          delete merged[key]
        } else {
          Object.assign(merged, { [key]: value })
        }
      }

      await db
        .update(organization)
        .set({ whitelabelSettings: merged, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))

      logger.info(`Admin API: Updated whitelabel settings for organization ${organizationId}`, {
        fields: Object.keys(incoming),
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: existing.name,
        description: `Admin API updated whitelabel settings for "${existing.name}"`,
        metadata: { fields: Object.keys(incoming) },
        request,
      })

      return singleResponse({ success: true as const, organizationId })
    } catch (error) {
      logger.error('Admin API: Failed to update whitelabel settings', { error, organizationId })
      return internalErrorResponse('Failed to update whitelabel settings')
    }
  })
)
