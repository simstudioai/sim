/**
 * GET /api/v1/admin/users/[id]/role
 *
 * Get a user's current role.
 *
 * Response: AdminSingleResponse<{ role: string | null }>
 *
 * PATCH /api/v1/admin/users/[id]/role
 *
 * Update a user's role.
 *
 * Body:
 *   - role: 'user' | 'admin' | 'superadmin' - The role to assign
 *
 * Response: AdminSingleResponse<AdminUser>
 */

import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminUser } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminUserRoleAPI')

const VALID_ROLES = ['user', 'admin', 'superadmin'] as const
type ValidRole = (typeof VALID_ROLES)[number]

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: userId } = await context.params

  try {
    const [userData] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    logger.info(`Admin API: Retrieved role for user ${userId}`)

    return singleResponse({ role: userData.role })
  } catch (error) {
    logger.error('Admin API: Failed to get user role', { error, userId })
    return internalErrorResponse('Failed to get user role')
  }
})

export const PATCH = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: userId } = await context.params

  try {
    const body = await request.json()

    const [existing] = await db.select().from(user).where(eq(user.id, userId)).limit(1)

    if (!existing) {
      return notFoundResponse('User')
    }

    if (body.role === undefined) {
      return badRequestResponse('role is required')
    }

    if (!VALID_ROLES.includes(body.role)) {
      return badRequestResponse(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`, {
        validRoles: VALID_ROLES,
      })
    }

    const [updated] = await db
      .update(user)
      .set({ role: body.role as ValidRole, updatedAt: new Date() })
      .where(eq(user.id, userId))
      .returning()

    logger.info(`Admin API: Updated user ${userId} role to ${body.role}`)

    return singleResponse(toAdminUser(updated))
  } catch (error) {
    logger.error('Admin API: Failed to update user role', { error, userId })
    return internalErrorResponse('Failed to update user role')
  }
})
