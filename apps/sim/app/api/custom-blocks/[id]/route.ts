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
  getCustomBlockById,
  updateCustomBlock,
} from '@/lib/workflows/custom-blocks/operations'
import { isOrganizationAdminOrOwner } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CustomBlockAPI')

type RouteContext = { params: Promise<{ id: string }> }

/** Load the block and confirm the caller is an admin/owner of its organization. */
async function authorizeManage(userId: string, id: string) {
  const block = await getCustomBlockById(id)
  if (!block) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  if (!(await isFeatureEnabled('deploy-as-block', { userId, orgId: block.organizationId }))) {
    return {
      error: NextResponse.json({ error: 'Deploy as block is not enabled' }, { status: 403 }),
    }
  }
  if (!(await isOrganizationAdminOrOwner(userId, block.organizationId))) {
    return { error: NextResponse.json({ error: 'Admin permissions required' }, { status: 403 }) }
  }
  return { block }
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
