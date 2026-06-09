import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { validateCopilotByokContract } from '@/lib/api/contracts/copilot'
import { parseRequest } from '@/lib/api/server'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { checkInternalApiKey } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { verifyEffectiveSuperUser } from '@/lib/permissions/super-user'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotByokValidate')

/**
 * Authoritative entitlement gate for enterprise BYOK, called server-to-server by
 * the mothership (Go) before it uses a workspace's own provider key. Gated by
 * INTERNAL_API_SECRET — never exposed to the browser.
 *
 * Returns 200 when EITHER:
 *   - the requesting user is a superuser admin (platform admin with superuser
 *     mode on), who may use BYOK on any workspace for management/testing; OR
 *   - the user is a member of the workspace (prevents one org from causing
 *     another org's stored key to be used) AND the workspace is on an
 *     enterprise plan.
 *
 * Any other case returns 403 (not entitled) or 401 (bad internal auth). The Go
 * caller fails closed to hosted keys on anything but a 200.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  const parsed = await parseRequest(validateCopilotByokContract, req, {})
  if (!parsed.success) return parsed.response

  const { workspaceId, userId } = parsed.data.body

  try {
    // Superuser admins may use BYOK on any workspace (management/testing).
    const { effectiveSuperUser } = await verifyEffectiveSuperUser(userId)
    if (effectiveSuperUser) {
      return new NextResponse(null, { status: 200 })
    }

    // Everyone else must be a workspace member on an enterprise plan. The
    // membership check prevents one org from using another org's stored key.
    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!permission) {
      logger.warn('BYOK validate denied: user is not a member of the workspace', {
        workspaceId,
        userId,
      })
      return new NextResponse(null, { status: 403 })
    }

    const eligible = await isWorkspaceOnEnterprisePlan(workspaceId)
    if (!eligible) {
      logger.warn('BYOK validate denied: workspace is not on an enterprise plan', { workspaceId })
      return new NextResponse(null, { status: 403 })
    }

    return new NextResponse(null, { status: 200 })
  } catch (error) {
    logger.error('BYOK validation failed', { error, workspaceId })
    return NextResponse.json({ error: 'Failed to validate BYOK entitlement' }, { status: 500 })
  }
})
