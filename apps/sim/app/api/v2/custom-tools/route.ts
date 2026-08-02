import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateCustomToolContract,
  v2ListCustomToolsContract,
} from '@/lib/api/contracts/v2/custom-tools'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getWorkspaceCustomToolByTitle,
  listWorkspaceCustomTools,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2CustomTool, v2CustomToolWriteError } from '@/app/api/v2/custom-tools/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CustomToolsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/custom-tools — List custom tools in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'custom-tools')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListCustomToolsContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, search, sortBy, sortOrder } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const rows = await listWorkspaceCustomTools({ workspaceId, search, sortBy, sortOrder })

    // The per-workspace tool set is small and bounded → a single full page.
    return v2CursorList(rows.map(toV2CustomTool), null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing custom tools`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/custom-tools — Create a custom tool. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'custom-tools')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateCustomToolContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, title, schema, code } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * Titles are unique per workspace and tools resolve by title at call time,
     * so a collision is reported rather than surfacing as a unique-index 500.
     */
    if (await getWorkspaceCustomToolByTitle({ workspaceId, title })) {
      return v2Error('CONFLICT', `A custom tool titled "${title}" already exists in this workspace`)
    }

    const tools = await upsertCustomTools({
      tools: [{ title, schema, code }],
      workspaceId,
      userId,
      requestId,
    })
    const created = tools.find((tool) => tool.title === title)
    if (!created) return v2Error('INTERNAL_ERROR', 'Internal server error')

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.CUSTOM_TOOL_CREATED,
      resourceType: AuditResourceType.CUSTOM_TOOL,
      resourceId: created.id,
      resourceName: created.title,
      description: `Created custom tool "${created.title}" via API`,
      request,
    })

    return v2Data({ customTool: toV2CustomTool(created) }, { rateLimit, status: 201 })
  } catch (error) {
    const writeError = v2CustomToolWriteError(error)
    if (writeError) return writeError

    logger.error(`[${requestId}] Error creating custom tool`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
