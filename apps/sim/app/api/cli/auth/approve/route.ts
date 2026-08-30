import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { approveCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getUserOrganization } from '@/lib/billing/organizations/membership'
import { createApproval } from '@/lib/cli-auth/approval-store'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  capabilityRefusal,
  isOrganizationCapabilityWithheld,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CliAuthApproveAPI')

/**
 * Whether `userId`'s permission group withholds CLI access.
 *
 * permission-group-enforced: cli.use — gates a device-auth handoff, which owns
 * no workspace resource for the authorization funnel to authorize.
 *
 * `workspaceId` is set only for a platform-scope handoff. A personal-scope
 * login has no workspace, so it falls back to the organization's default group
 * rather than going ungoverned — otherwise the narrower scope would be the
 * unguarded one.
 */
async function cliAccessWithheld(userId: string, workspaceId?: string): Promise<boolean> {
  if (workspaceId) return isWorkspaceCapabilityWithheld(userId, workspaceId, 'cli.use')

  const membership = await getUserOrganization(userId)
  if (!membership) return false
  return isOrganizationCapabilityWithheld(membership.organizationId, 'cli.use')
}

/**
 * Whether `userId`'s permission group withholds minting the key this approval
 * would redeem for.
 *
 * permission-group-enforced: api_keys.manage — a raw device-auth handler with
 * inline queries, which the authorization funnel never sees.
 *
 * This is the door the workspace-key pass-through depends on. A
 * `workspace_api_key` principal resolves no user and therefore no group, so the
 * funnel's capability gate never applies to it; the whole safety argument for
 * that pass-through (`workspace-authorization.ts`, `app/api/table/utils.ts`,
 * `app/api/v1/middleware.ts` all state it) is that minting one is itself
 * capability-gated. `/api/workspaces/[id]/api-keys` gates it; without this the
 * terminal was the way around, and a member denied `api_keys.manage` could mint
 * the identical key with `sim login --workspace` and then out-rank every other
 * capability their group withholds.
 *
 * Resolved from the key's own scope, matching the surface that mints the same
 * key: a bound key belongs to `workspaceId`, so the workspace group governs it,
 * while a personal key is user-global and belongs to no workspace, so it falls
 * back to the organization's default group exactly as
 * `/api/users/me/api-keys` does.
 */
async function apiKeyMintWithheld(userId: string, workspaceId?: string): Promise<boolean> {
  if (workspaceId) return isWorkspaceCapabilityWithheld(userId, workspaceId, 'api_keys.manage')

  const membership = await getUserOrganization(userId)
  if (!membership) return false
  return isOrganizationCapabilityWithheld(membership.organizationId, 'api_keys.manage')
}

/**
 * Records a signed-in user's approval of a CLI handoff so the waiting terminal's
 * poll can complete.
 *
 * The approving user comes from the session and nothing else — a client-supplied
 * user id here would let any caller approve a request redeemable for someone
 * else's key. No key is generated until the CLI polls.
 *
 * Workspace binding, CLI access, and permission to mint the key at all are
 * authorized here rather than at poll time: the poll is unauthenticated by
 * necessity, so it has no session to check a permission against, and re-checking
 * there would duplicate this decision while racing a permission-group change
 * made between the two calls. Approving is the only moment a human is present.
 *
 * That makes the approval record the sole carrier of the decision. The poll body
 * is a request id and a secret and nothing else, so it cannot assert a scope, a
 * workspace, or a binding of its own — a refusal here writes no record, and a
 * poll driven directly against the same request id answers `pending` forever.
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

  if (await cliAccessWithheld(session.user.id, workspaceId)) {
    logger.warn('CLI authorization blocked by permission group', {
      userId: session.user.id,
      scope,
      workspaceId: workspaceId ?? null,
    })
    return NextResponse.json({ error: capabilityRefusal('cli.use') }, { status: 403 })
  }

  // The platform scope is the one that redeems for a Sim API key. A copilot
  // approval mints from a separate key space that the API-keys surface does not
  // manage, so `cli.use` above is the whole gate for it.
  if (scope === 'platform') {
    const mintWorkspaceId = bindKeyToWorkspace ? workspaceId : undefined
    if (await apiKeyMintWithheld(session.user.id, mintWorkspaceId)) {
      logger.warn('CLI key mint blocked by permission group', {
        userId: session.user.id,
        workspaceId: mintWorkspaceId ?? null,
      })
      return NextResponse.json({ error: capabilityRefusal('api_keys.manage') }, { status: 403 })
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
