/**
 * GET /api/v1/admin/workspaces
 *
 * List all workspaces with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminWorkspace>
 */

import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminWorkspace,
  createPaginationMeta,
  parsePaginationParams,
  toAdminWorkspace,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspacesAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, workspaces] = await Promise.all([
      db.select({ total: count() }).from(workspace),
      db.select().from(workspace).orderBy(workspace.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminWorkspace[] = workspaces.map(toAdminWorkspace)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} workspaces (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list workspaces', { error })
    return internalErrorResponse('Failed to list workspaces')
  }
})
