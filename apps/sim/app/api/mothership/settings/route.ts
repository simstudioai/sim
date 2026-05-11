import { db, settings, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getMothershipSettingsContract,
  updateMothershipSettingsContract,
} from '@/lib/api/contracts/mothership-settings'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getMothershipSettings,
  updateMothershipSettings,
} from '@/lib/mothership/settings/operations'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipSettingsAPI')

async function isEffectiveSuperUser(userId: string): Promise<boolean> {
  const [row] = await db
    .select({
      role: user.role,
      superUserModeEnabled: settings.superUserModeEnabled,
    })
    .from(user)
    .leftJoin(settings, eq(settings.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1)

  return row?.role === 'admin' && (row.superUserModeEnabled ?? false)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!(await isEffectiveSuperUser(auth.userId))) {
      return NextResponse.json({ error: 'Super admin mode required' }, { status: 403 })
    }

    const parsed = await parseRequest(getMothershipSettingsContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query
    const userPermission = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermission) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const settings = await getMothershipSettings(workspaceId)
    return NextResponse.json({ data: settings })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Mothership settings`, error)
    return NextResponse.json({ error: 'Failed to fetch Mothership settings' }, { status: 500 })
  }
})

export const PUT = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!(await isEffectiveSuperUser(auth.userId))) {
      return NextResponse.json({ error: 'Super admin mode required' }, { status: 403 })
    }

    const parsed = await parseRequest(updateMothershipSettingsContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.body
    const userPermission = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const settings = await updateMothershipSettings(parsed.data.body)
    return NextResponse.json({ success: true, data: settings })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Mothership settings`, error)
    return NextResponse.json({ error: 'Failed to update Mothership settings' }, { status: 500 })
  }
})
