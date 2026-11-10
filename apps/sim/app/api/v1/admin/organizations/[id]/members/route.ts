/**
 * GET /api/v1/admin/organizations/[id]/members
 *
 * List all members of an organization with their billing info.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminMemberDetail>
 *
 * POST /api/v1/admin/organizations/[id]/members
 *
 * Add a user to an organization with full billing logic, matching invitation
 * acceptance:
 *   - Enterprise: the fixed `metadata.seats` cap is enforced before adding.
 *   - Team: seats are elastic, so no cap is checked and the subscription is
 *     grown to the new member count afterwards.
 * Handles Pro usage snapshot and subscription cancellation like the invitation flow.
 * If user is already a member, updates their role if different.
 *
 * Body:
 *   - userId: string - User ID to add
 *   - role: string - Role ('admin' | 'member')
 *
 * Response: AdminSingleResponse<AdminMember & {
 *   action: 'created' | 'updated' | 'already_member',
 *   billingActions: { proUsageSnapshotted, proCancelledAtPeriodEnd }
 * }>
 */

import { createLogger } from '@sim/logger'
import {
  adminV1AddOrganizationMemberContract,
  adminV1ListOrganizationMembersContract,
} from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  AdminMemberAddRefusedError,
  AdminMemberTargetNotFoundError,
  addAdminOrganizationMember,
  listAdminOrganizationMembers,
} from '@/lib/organizations/application/admin-members'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminBadRequestResponse,
  adminInternalErrorResponse,
  adminInvalidJsonResponse,
  adminNotFoundResponse,
  adminValidationErrorResponse,
  adminWriteErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminMember,
  type AdminMemberDetail,
  createPaginationMeta,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationMembersAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context, principal) => {
    const parsed = await parseRequest(adminV1ListOrganizationMembersContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { limit, offset } = parsed.data.query

    try {
      const { members, total } = await listAdminOrganizationMembers.execute({
        principal,
        input: { organizationId, limit, offset },
        request,
      })

      const data: AdminMemberDetail[] = members.map((m) => ({
        id: m.id,
        userId: m.userId,
        organizationId: m.organizationId,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        userName: m.userName,
        userEmail: m.userEmail,
        currentPeriodCost: m.currentPeriodCost.toString(),
        currentUsageLimit: m.currentUsageLimit,
        billingBlocked: m.billingBlocked,
      }))

      return listResponse(data, createPaginationMeta(total, limit, offset))
    } catch (error) {
      if (error instanceof AdminMemberTargetNotFoundError) {
        return adminNotFoundResponse(error.resource)
      }
      logger.error('Admin API: Failed to list organization members', { error, organizationId })
      return adminInternalErrorResponse('Failed to list organization members')
    }
  })
)

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context, principal) => {
    const parsed = await parseRequest(adminV1AddOrganizationMemberContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
      invalidJsonResponse: adminInvalidJsonResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { userId, role } = parsed.data.body

    try {
      const result = await addAdminOrganizationMember.execute({
        principal,
        input: { organizationId, userId, role },
        request,
      })

      const data: AdminMember = {
        id: result.memberId,
        userId,
        organizationId,
        role: result.role,
        createdAt: result.createdAt.toISOString(),
        userName: result.userName,
        userEmail: result.userEmail,
      }
      return singleResponse({
        ...data,
        action: result.action,
        billingActions: result.billingActions,
      })
    } catch (error) {
      if (error instanceof AdminMemberTargetNotFoundError) {
        return adminNotFoundResponse(error.resource)
      }
      if (error instanceof AdminMemberAddRefusedError) {
        return adminBadRequestResponse(error.message)
      }
      logger.error('Admin API: Failed to add organization member', { error, organizationId })
      return adminWriteErrorResponse(error, 'Failed to add organization member')
    }
  })
)
