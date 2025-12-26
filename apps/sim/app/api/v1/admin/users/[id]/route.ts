/**
 * GET /api/v1/admin/users/[id]
 *
 * Get user details.
 *
 * Response: AdminSingleResponse<AdminUser>
 */

import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminUser } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminUserDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: userId } = await context.params

  try {
    const [userData] = await db.select().from(user).where(eq(user.id, userId)).limit(1)

    if (!userData) {
      return notFoundResponse('User')
    }

    const data = toAdminUser(userData)

    logger.info(`Admin API: Retrieved user ${userId}`)

    return singleResponse(data)
  } catch (error) {
    logger.error('Admin API: Failed to get user', { error, userId })
    return internalErrorResponse('Failed to get user')
  }
})
