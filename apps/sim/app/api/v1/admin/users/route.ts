/**
 * GET /api/v1/admin/users
 *
 * List all users with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminUser>
 */

import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminUser,
  createPaginationMeta,
  parsePaginationParams,
  toAdminUser,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminUsersAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, users] = await Promise.all([
      db.select({ total: count() }).from(user),
      db.select().from(user).orderBy(user.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminUser[] = users.map(toAdminUser)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} users (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list users', { error })
    return internalErrorResponse('Failed to list users')
  }
})
