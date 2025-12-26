/**
 * GET /api/v1/admin/organizations
 *
 * List all organizations with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminOrganization>
 */

import { db } from '@sim/db'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminOrganization,
  createPaginationMeta,
  parsePaginationParams,
  toAdminOrganization,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminOrganizationsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, organizations] = await Promise.all([
      db.select({ total: count() }).from(organization),
      db.select().from(organization).orderBy(organization.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminOrganization[] = organizations.map(toAdminOrganization)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} organizations (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list organizations', { error })
    return internalErrorResponse('Failed to list organizations')
  }
})
