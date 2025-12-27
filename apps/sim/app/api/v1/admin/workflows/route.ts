/**
 * GET /api/v1/admin/workflows
 *
 * List all workflows across all workspaces with pagination.
 *
 * Query Parameters:
 *   - limit: number (default: 50, max: 250)
 *   - offset: number (default: 0)
 *
 * Response: AdminListResponse<AdminWorkflow>
 */

import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count } from 'drizzle-orm'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import { internalErrorResponse, listResponse } from '@/app/api/v1/admin/responses'
import {
  type AdminWorkflow,
  createPaginationMeta,
  parsePaginationParams,
  toAdminWorkflow,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowsAPI')

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, workflows] = await Promise.all([
      db.select({ total: count() }).from(workflow),
      db.select().from(workflow).orderBy(workflow.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminWorkflow[] = workflows.map(toAdminWorkflow)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} workflows (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list workflows', { error })
    return internalErrorResponse('Failed to list workflows')
  }
})
