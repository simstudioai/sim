/**
 * GET /api/v1/admin/organizations/[id]
 *
 * Get organization details including member count and subscription.
 *
 * Response: AdminSingleResponse<AdminOrganizationDetail>
 *
 * PATCH /api/v1/admin/organizations/[id]
 *
 * Update organization details.
 *
 * Body:
 *   - name?: string - Organization name
 *   - slug?: string - Organization slug
 *
 * Response: AdminSingleResponse<AdminOrganization>
 *
 * DELETE /api/v1/admin/organizations/[id]
 *
 * Permanently delete an organization. Members, invitations, permission groups,
 * and org-level settings go with it. Its workspaces are detached first — moved
 * back to their own billing account with their storage ledger transferred — and
 * survive the delete.
 *
 * Refuses with 409 when a subscription still references the organization.
 *
 * Query:
 *   - confirmSlug: string - Must equal the organization's slug
 *
 * Response: AdminSingleResponse<{ success, organizationId, slug, membersRemoved, workspacesDetached }>
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, count, eq, inArray, isNull, not, or } from 'drizzle-orm'
import {
  adminV1DeleteOrganizationContract,
  adminV1GetOrganizationContract,
  adminV1UpdateOrganizationContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import {
  ensureOrganizationSlugAvailable,
  OrganizationSlugInvalidError,
  OrganizationSlugTakenError,
  validateOrganizationSlugOrThrow,
} from '@/lib/billing/organizations/create-organization'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
} from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { detachOrganizationWorkspacesTx } from '@/lib/workspaces/organization-workspaces'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminInvalidJsonResponse,
  adminValidationErrorResponse,
  badRequestResponse,
  conflictResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminOrganizationDetail,
  toAdminOrganization,
  toAdminSubscription,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

    try {
      const [orgData] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!orgData) {
        return notFoundResponse('Organization')
      }

      const [memberCountResult, subscriptionData] = await Promise.all([
        db.select({ count: count() }).from(member).where(eq(member.organizationId, organizationId)),
        db
          .select()
          .from(subscription)
          .where(
            and(
              eq(subscription.referenceId, organizationId),
              inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES)
            )
          )
          .limit(1),
      ])

      const data: AdminOrganizationDetail = {
        ...toAdminOrganization(orgData),
        memberCount: memberCountResult[0].count,
        subscription: subscriptionData[0] ? toAdminSubscription(subscriptionData[0]) : null,
      }

      logger.info(`Admin API: Retrieved organization ${organizationId}`)

      return singleResponse(data)
    } catch (error) {
      logger.error('Admin API: Failed to get organization', { error, organizationId })
      return internalErrorResponse('Failed to get organization')
    }
  })
)

export const PATCH = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1UpdateOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params

    try {
      const [existing] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!existing) {
        return notFoundResponse('Organization')
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      const validatedBody = parsed.data.body

      if (validatedBody.name !== undefined) {
        updateData.name = validatedBody.name
      }

      if (validatedBody.slug !== undefined) {
        const nextSlug = validatedBody.slug
        validateOrganizationSlugOrThrow(nextSlug)
        await ensureOrganizationSlugAvailable({
          slug: nextSlug,
          excludeOrganizationId: organizationId,
        })
        updateData.slug = nextSlug
      }

      if (Object.keys(updateData).length === 1) {
        return badRequestResponse(
          'No valid fields to update. Use /billing endpoint for orgUsageLimit.'
        )
      }

      const [updated] = await db
        .update(organization)
        .set(updateData)
        .where(eq(organization.id, organizationId))
        .returning()

      logger.info(`Admin API: Updated organization ${organizationId}`, {
        fields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: updated.name,
        description: `Admin API updated organization "${updated.name}"`,
        metadata: { fields: Object.keys(updateData).filter((k) => k !== 'updatedAt') },
        request,
      })

      return singleResponse(toAdminOrganization(updated))
    } catch (error) {
      if (error instanceof OrganizationSlugInvalidError) {
        return badRequestResponse(
          'Organization slug can only contain lowercase letters, numbers, hyphens, and underscores.'
        )
      }

      if (error instanceof OrganizationSlugTakenError) {
        return badRequestResponse('This slug is already taken')
      }

      logger.error('Admin API: Failed to update organization', { error, organizationId })
      return internalErrorResponse('Failed to update organization')
    }
  })
)

export const DELETE = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1DeleteOrganizationContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { confirmSlug } = parsed.data.query

    try {
      const [existing] = await db
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!existing) {
        return notFoundResponse('Organization')
      }

      if (confirmSlug !== existing.slug) {
        return badRequestResponse(
          `confirmSlug does not match this organization's slug. Pass confirmSlug=${existing.slug} to confirm deletion.`
        )
      }

      /**
       * `subscription.reference_id` is polymorphic — it holds either a user id
       * or an organization id — so it carries no foreign key and nothing
       * cascades. Deleting an organization out from under a live subscription
       * would strand it, and its Stripe billing, against an id that no longer
       * resolves. Refuse instead of guessing whether to cancel.
       *
       * Scoped to non-terminal rows. A canceled row bills nobody, so treating
       * it as a blocker would make an organization that once had a
       * subscription permanently undeletable — but entitlement is the wrong
       * test in the other direction too, since a `trialing` subscription grants
       * nothing today and is still live in Stripe. A null status is unknown, so
       * it blocks.
       */
      const [existingSubscription] = await db
        .select({ id: subscription.id, plan: subscription.plan })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, organizationId),
            or(
              isNull(subscription.status),
              not(inArray(subscription.status, TERMINAL_SUBSCRIPTION_STATUSES))
            )
          )
        )
        .limit(1)

      if (existingSubscription) {
        return conflictResponse(
          `Organization still has a "${existingSubscription.plan}" subscription. Cancel it before deleting the organization.`
        )
      }

      const [memberCountRow] = await db
        .select({ value: count() })
        .from(member)
        .where(eq(member.organizationId, organizationId))

      /**
       * Detach before deleting rather than leaning on the `ON DELETE SET NULL`
       * foreign key. The key only clears `organization_id`; it leaves
       * `workspace_mode` at `organization` — a state the cleanup dispatcher
       * treats as malformed and skips — keeps `billed_account_user_id` pointed
       * at the departing organization, and drops the organization's storage
       * ledger without returning those bytes to the workspace's new payer.
       * This helper does the payer transfer, resets the mode, and re-grants
       * admin permissions.
       *
       * Both run in one transaction: a detach that committed on its own would
       * leave workspaces re-billed to their owners while the organization,
       * its members, and its settings survived a failed delete.
       */
      const { detachedWorkspaceIds } = await db.transaction(async (tx) => {
        const detached = await detachOrganizationWorkspacesTx(tx, organizationId)
        await tx.delete(organization).where(eq(organization.id, organizationId))
        return detached
      })

      logger.info(`Admin API: Deleted organization ${organizationId}`, {
        slug: existing.slug,
        membersRemoved: memberCountRow?.value ?? 0,
        workspacesDetached: detachedWorkspaceIds.length,
      })

      recordAudit({
        workspaceId: null,
        actorId: 'admin-api',
        action: AuditAction.ORGANIZATION_DELETED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        resourceName: existing.name,
        description: `Admin API deleted organization "${existing.name}"`,
        metadata: {
          slug: existing.slug,
          membersRemoved: memberCountRow?.value ?? 0,
          workspacesDetached: detachedWorkspaceIds.length,
        },
        request,
      })

      return singleResponse({
        success: true as const,
        organizationId,
        slug: existing.slug,
        membersRemoved: memberCountRow?.value ?? 0,
        workspacesDetached: detachedWorkspaceIds.length,
      })
    } catch (error) {
      logger.error('Admin API: Failed to delete organization', { error, organizationId })
      return internalErrorResponse('Failed to delete organization')
    }
  })
)
