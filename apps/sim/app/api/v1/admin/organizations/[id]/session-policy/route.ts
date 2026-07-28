/**
 * PATCH /api/v1/admin/organizations/[id]/session-policy
 *
 * Set an organization's session policy without going through the settings UI,
 * so a self-hosted deployment can provision it from its own configuration
 * management.
 *
 * Body:
 *   - maxSessionHours: number | null - Absolute session lifetime cap
 *   - idleTimeoutHours: number | null - Idle timeout
 *
 * Response: AdminSingleResponse<{ success, organizationId }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import { adminV1UpdateOrganizationSessionPolicyContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { invalidateSecurityPolicyVersionCache } from '@/lib/auth/security-policy'
import { eagerClampOrgSessions, invalidateSessionPolicyCache } from '@/lib/auth/session-policy'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminOrganizationSessionPolicyAPI')

interface RouteParams {
  id: string
}

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(
      adminV1UpdateOrganizationSessionPolicyContract,
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
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!existing) {
        return notFoundResponse('Organization')
      }

      const merged = {
        maxSessionHours: body.maxSessionHours,
        idleTimeoutHours: body.idleTimeoutHours,
      }

      /**
       * Mirrors the settings-UI write: the policy, the security-policy version
       * bump, and the clamp of already-issued sessions commit together, so a
       * stored policy is never left unenforced by a partial failure.
       */
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(organization)
          .set({
            sessionPolicySettings: merged,
            securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(organization.id, organizationId))
          .returning({ id: organization.id })
        if (!row) return null
        await eagerClampOrgSessions(organizationId, merged, tx)
        return row
      })

      if (!updated) {
        return notFoundResponse('Organization')
      }

      invalidateSessionPolicyCache(organizationId)
      invalidateSecurityPolicyVersionCache(organizationId)

      logger.info(`Admin API: Updated session policy for organization ${organizationId}`)

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_SESSION_POLICY_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: existing.name,
        description: `Admin API updated the session policy for "${existing.name}"`,
        metadata: { changes: body },
        request,
      })

      return singleResponse({ success: true as const, organizationId })
    } catch (error) {
      logger.error('Admin API: Failed to update session policy', { error, organizationId })
      return internalErrorResponse('Failed to update session policy')
    }
  })
)
