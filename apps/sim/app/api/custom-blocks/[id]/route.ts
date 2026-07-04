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
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  CustomBlockValidationError,
  deleteCustomBlock,
  getCustomBlockManageContext,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import { hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CustomBlockAPI')

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Confirm the caller can manage (edit/delete) the block: admin of the block's
 * SOURCE workflow's workspace — matching who could publish it. Org admins/owners
 * hold admin on every org workspace, so they pass too; a workspace admin from a
 * different workspace does not, so they cannot alter another workspace's block or
 * its exposed outputs.
 */
async function authorizeManage(userId: string, id: string) {
  const ctx = await getCustomBlockManageContext(id)
  if (!ctx) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  if (!(await isFeatureEnabled('deploy-as-block', { userId, orgId: ctx.organizationId }))) {
    return {
      error: NextResponse.json({ error: 'Deploy as block is not enabled' }, { status: 403 }),
    }
  }
  if (!ctx.sourceWorkspaceId || !(await hasWorkspaceAdminAccess(userId, ctx.sourceWorkspaceId))) {
    return { error: NextResponse.json({ error: 'Admin permissions required' }, { status: 403 }) }
  }
  return { error: null }
}

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

  const { name, description, enabled, iconUrl, exposedOutputs } = parsed.data.body
  try {
    await updateCustomBlock(id, {
      name,
      description,
      enabled,
      iconUrl,
      exposedOutputs,
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

  await deleteCustomBlock(id)
  return NextResponse.json({ success: true as const })
})
