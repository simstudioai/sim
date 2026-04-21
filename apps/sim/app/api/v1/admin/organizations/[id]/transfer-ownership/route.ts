import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { transferOrganizationOwnership } from '@/lib/billing/organizations/membership'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'

const logger = createLogger('AdminTransferOwnershipAPI')

interface RouteParams {
  id: string
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: organizationId } = await context.params

  try {
    const body = await request.json().catch(() => null)
    const newOwnerUserId: unknown = body?.newOwnerUserId
    const currentOwnerUserIdOverride: unknown = body?.currentOwnerUserId

    if (typeof newOwnerUserId !== 'string' || newOwnerUserId.length === 0) {
      return badRequestResponse('newOwnerUserId is required')
    }

    if (
      currentOwnerUserIdOverride !== undefined &&
      (typeof currentOwnerUserIdOverride !== 'string' || currentOwnerUserIdOverride.length === 0)
    ) {
      return badRequestResponse('currentOwnerUserId must be a non-empty string when provided')
    }

    const [orgRow] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!orgRow) {
      return notFoundResponse('Organization')
    }

    let currentOwnerUserId: string
    if (typeof currentOwnerUserIdOverride === 'string') {
      currentOwnerUserId = currentOwnerUserIdOverride
    } else {
      const [ownerMembership] = await db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')))
        .limit(1)

      if (!ownerMembership) {
        return badRequestResponse(
          'Organization has no owner; provide currentOwnerUserId explicitly to seed ownership'
        )
      }

      currentOwnerUserId = ownerMembership.userId
    }

    if (currentOwnerUserId === newOwnerUserId) {
      return badRequestResponse('New owner must differ from current owner')
    }

    const [newOwnerMember] = await db
      .select({
        id: member.id,
        role: member.role,
        email: user.email,
        name: user.name,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, newOwnerUserId)))
      .limit(1)

    if (!newOwnerMember) {
      return badRequestResponse('Target user is not a member of this organization')
    }

    const result = await transferOrganizationOwnership({
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
    })

    if (!result.success) {
      return internalErrorResponse(result.error ?? 'Failed to transfer ownership')
    }

    logger.info(`Admin API: Transferred ownership of organization ${organizationId}`, {
      currentOwnerUserId,
      newOwnerUserId,
      workspacesReassigned: result.workspacesReassigned,
      billedAccountReassigned: result.billedAccountReassigned,
      overageMigrated: result.overageMigrated,
      billingBlockInherited: result.billingBlockInherited,
    })

    return singleResponse({
      organizationId,
      currentOwnerUserId,
      newOwnerUserId,
      workspacesReassigned: result.workspacesReassigned,
      billedAccountReassigned: result.billedAccountReassigned,
      overageMigrated: result.overageMigrated,
      billingBlockInherited: result.billingBlockInherited,
    })
  } catch (error) {
    logger.error('Admin API: Failed to transfer organization ownership', {
      organizationId,
      error,
    })
    return internalErrorResponse('Failed to transfer ownership')
  }
})
