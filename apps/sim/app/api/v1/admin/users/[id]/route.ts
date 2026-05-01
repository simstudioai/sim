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
import { adminV1GetUserContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  adminValidationErrorResponse,
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import { toAdminUser } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminUserDetailAPI')

interface RouteParams {
  id: string
}

export const GET = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1GetUserContract, request, context, {
      validationErrorResponse: adminValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { id: userId } = parsed.data.params

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
)
