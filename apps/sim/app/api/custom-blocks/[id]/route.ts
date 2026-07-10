import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  deleteCustomBlockContract,
  updateCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  CustomBlockValidationError,
  deleteCustomBlock,
  getCustomBlockUsageCounts,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import { authorizeManage } from '@/app/api/custom-blocks/[id]/authorize-manage'

const logger = createLogger('CustomBlockAPI')

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(updateCustomBlockContract, request, context)
  if (!parsed.success) return parsed.response

  const { id } = parsed.data.params
  const authz = await authorizeManage(session.user.id, id)
  if (authz.error) return authz.error
  const { ctx } = authz

  const { name, description, enabled, iconUrl, inputs, exposedOutputs } = parsed.data.body
  try {
    await updateCustomBlock(id, {
      name,
      description,
      enabled,
      inputs,
      iconUrl,
      exposedOutputs,
    })
    recordAudit({
      workspaceId: ctx.sourceWorkspaceId,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.CUSTOM_BLOCK_UPDATED,
      resourceType: AuditResourceType.CUSTOM_BLOCK,
      resourceId: id,
      resourceName: name ?? ctx.name,
      description: `Updated custom block "${name ?? ctx.name}"`,
      metadata: { organizationId: ctx.organizationId, type: ctx.type },
      request,
    })
    return NextResponse.json({ success: true as const })
  } catch (error) {
    if (error instanceof CustomBlockValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error('Failed to update custom block', { id, error: getErrorMessage(error) })
    throw error
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(deleteCustomBlockContract, request, context)
  if (!parsed.success) return parsed.response

  const { id } = parsed.data.params
  const authz = await authorizeManage(session.user.id, id)
  if (authz.error) return authz.error
  const { ctx } = authz

  const usageCounts = await getCustomBlockUsageCounts(ctx.organizationId, ctx.type)
  await deleteCustomBlock(id)
  recordAudit({
    workspaceId: ctx.sourceWorkspaceId,
    actorId: session.user.id,
    actorName: session.user.name,
    actorEmail: session.user.email,
    action: AuditAction.CUSTOM_BLOCK_DELETED,
    resourceType: AuditResourceType.CUSTOM_BLOCK,
    resourceId: id,
    resourceName: ctx.name,
    description: `Unpublished custom block "${ctx.name}"`,
    metadata: {
      organizationId: ctx.organizationId,
      type: ctx.type,
      usageCount: usageCounts.usageCount,
      deployedUsageCount: usageCounts.deployedUsageCount,
    },
    request,
  })
  return NextResponse.json({ success: true as const })
})
