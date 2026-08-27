import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { approveCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createApproval } from '@/lib/cli-auth/approval-store'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CliAuthApproveAPI')

/**
 * Records a signed-in user's approval of a CLI handoff so the waiting terminal's
 * poll can complete.
 *
 * The approving user comes from the session and nothing else — a client-supplied
 * user id here would let any caller approve a request redeemable for someone
 * else's key. No key is generated until the CLI polls.
 *
 * Workspace binding is authorized here rather than at poll time: the poll is
 * unauthenticated by necessity, so it has no session to check a permission
 * against. Approving is the only moment a human is present.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimited = await enforceUserRateLimit('cli-auth-approve', session.user.id)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(approveCliAuthContract, request, {})
  if (!parsed.success) return parsed.response

  const { request: requestId, challenge, scope, workspaceId, bindKeyToWorkspace } = parsed.data.body

  if ((workspaceId || bindKeyToWorkspace) && scope !== 'platform') {
    return NextResponse.json(
      { error: 'workspaceId is only valid for the platform scope' },
      { status: 400 }
    )
  }

  if (bindKeyToWorkspace && !workspaceId) {
    return NextResponse.json(
      { error: 'bindKeyToWorkspace requires a workspaceId' },
      { status: 400 }
    )
  }

  if (workspaceId) {
    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

    // Reading the workspace at all requires membership. Without this, the
    // terminal could be handed the id of a workspace the approver cannot see —
    // harmless for the key, but it would silently become the profile default and
    // every later command would 403 with no explanation.
    if (!permission) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    // Minting a workspace key is an admin action wherever else it is offered;
    // the terminal is not a lower bar. Rejected outright rather than downgraded
    // to a personal key, so the CLI never quietly stores a different credential
    // than the browser said it would.
    if (bindKeyToWorkspace && permission !== 'admin') {
      return NextResponse.json(
        { error: 'Workspace admin permission is required to issue a workspace API key' },
        { status: 403 }
      )
    }
  }

  await createApproval(session.user.id, requestId, challenge, {
    scope,
    workspaceId,
    workspaceBound: bindKeyToWorkspace,
  })
  logger.info('Recorded CLI authorization approval', {
    userId: session.user.id,
    scope,
    workspaceId: workspaceId ?? null,
    workspaceBound: bindKeyToWorkspace,
  })

  return NextResponse.json({ ok: true })
})
