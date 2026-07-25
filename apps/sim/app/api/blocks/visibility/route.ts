import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getBlockVisibilityContract } from '@/lib/api/contracts/block-visibility'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Evaluates the viewer's block-visibility projection for a workspace: which
 * preview blocks are revealed (and preview-tagged) and which shipped blocks are
 * kill-switched. Consumed by the client visibility overlay
 * (`BlockVisibilityLoader`); discovery-only — execution is never gated.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getBlockVisibilityContract, request, {})
  if (!parsed.success) return parsed.response

  const userId = session.user.id
  const { workspaceId } = parsed.data.query

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const isAdmin = await isPlatformAdmin(userId)
  const vis = await getBlockVisibility({
    userId,
    orgId: access.workspace?.organizationId,
    isAdmin,
  })

  return NextResponse.json({
    revealed: [...vis.revealed],
    disabled: [...vis.disabled],
    previewTagged: [...vis.previewTagged],
  })
})
