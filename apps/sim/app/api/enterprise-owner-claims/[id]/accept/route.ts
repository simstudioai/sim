import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { acceptEnterpriseOwnerClaimContract } from '@/lib/api/contracts/enterprise-owner-claims'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { acceptEnterpriseOwnerClaim } from '@/lib/billing/enterprise-owner-claim'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('EnterpriseOwnerClaimAcceptAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if (!session.user.emailVerified) {
      return NextResponse.json(
        {
          error: 'email-unverified',
          message: 'Verify the invited email before accepting Enterprise ownership.',
        },
        { status: 403 }
      )
    }
    const parsed = await parseRequest(acceptEnterpriseOwnerClaimContract, request, context)
    if (!parsed.success) return parsed.response
    const result = await acceptEnterpriseOwnerClaim({
      claimId: parsed.data.params.id,
      token: parsed.data.body.token,
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name,
      disclosedWorkspaceIds: parsed.data.body.disclosedWorkspaceIds,
      disclosedCreatesDefaultWorkspace: parsed.data.body.disclosedCreatesDefaultWorkspace,
    })
    if (!result.success) {
      const statusByKind: Record<typeof result.kind, number> = {
        'not-found': 404,
        'invalid-token': 400,
        expired: 400,
        revoked: 400,
        'email-mismatch': 403,
        'already-in-organization': 409,
        'disclosure-outdated': 409,
        'workspace-limit': 400,
        'workspace-invitation-limit': 400,
        'insufficient-seats': 400,
        'server-error': 500,
      }
      logger.warn('Enterprise owner claim acceptance rejected', {
        claimId: parsed.data.params.id,
        reason: result.kind,
      })
      return NextResponse.json(
        { error: result.kind, ...(result.message ? { message: result.message } : {}) },
        { status: statusByKind[result.kind] }
      )
    }
    return NextResponse.json(result)
  }
)
