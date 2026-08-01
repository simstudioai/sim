import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2DeleteCustomToolContract,
  v2GetCustomToolContract,
  v2UpdateCustomToolContract,
} from '@/lib/api/contracts/v2/custom-tools'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteWorkspaceCustomTool,
  getWorkspaceCustomTool,
  getWorkspaceCustomToolByTitle,
  upsertCustomTools,
} from '@/lib/workflows/custom-tools/operations'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2CustomTool, v2CustomToolWriteError } from '@/app/api/v2/custom-tools/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CustomToolDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET /api/v2/custom-tools/[id] — Fetch a single custom tool. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'custom-tool-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetCustomToolContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const tool = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!tool) return v2Error('NOT_FOUND', 'Custom tool not found')

    return v2Data({ customTool: toV2CustomTool(tool) }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom tool`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** PATCH /api/v2/custom-tools/[id] — Update a custom tool. Omitted fields keep their values. */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'custom-tool-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpdateCustomToolContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId, title, schema, code } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const current = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!current) return v2Error('NOT_FOUND', 'Custom tool not found')

    /**
     * `upsertCustomTools` replaces title/schema/code wholesale and checks for a
     * duplicate title only when inserting, so a rename onto an existing title
     * would hit the `custom_tools_workspace_title_unique` index as a 500. Merge
     * the partial body against the stored row and check the rename here.
     */
    if (title !== undefined && title !== current.title) {
      if (await getWorkspaceCustomToolByTitle({ workspaceId, title })) {
        return v2Error(
          'CONFLICT',
          `A custom tool titled "${title}" already exists in this workspace`
        )
      }
    }

    await upsertCustomTools({
      tools: [
        {
          id,
          title: title ?? current.title,
          schema: schema ?? current.schema,
          code: code ?? current.code,
        },
      ],
      workspaceId,
      userId,
      requestId,
    })

    const updated = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!updated) return v2Error('NOT_FOUND', 'Custom tool not found')

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.CUSTOM_TOOL_UPDATED,
      resourceType: AuditResourceType.CUSTOM_TOOL,
      resourceId: updated.id,
      resourceName: updated.title,
      description: `Updated custom tool "${updated.title}" via API`,
      request,
    })

    return v2Data({ customTool: toV2CustomTool(updated) }, { rateLimit })
  } catch (error) {
    const writeError = v2CustomToolWriteError(error)
    if (writeError) return writeError

    logger.error(`[${requestId}] Error updating custom tool`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** DELETE /api/v2/custom-tools/[id] — Delete a custom tool. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'custom-tool-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2DeleteCustomToolContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { id } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const tool = await getWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!tool) return v2Error('NOT_FOUND', 'Custom tool not found')

    const deleted = await deleteWorkspaceCustomTool({ workspaceId, toolId: id })
    if (!deleted) return v2Error('NOT_FOUND', 'Custom tool not found')

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.CUSTOM_TOOL_DELETED,
      resourceType: AuditResourceType.CUSTOM_TOOL,
      resourceId: id,
      resourceName: tool.title,
      description: `Deleted custom tool "${tool.title}" via API`,
      request,
    })

    return v2Data({ id, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom tool`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
