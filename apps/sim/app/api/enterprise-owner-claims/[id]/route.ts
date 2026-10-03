import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getEnterpriseOwnerClaimContract } from '@/lib/api/contracts/enterprise-owner-claims'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import {
  EnterpriseOwnerClaimEmailMismatchError,
  EnterpriseOwnerClaimWorkspaceLimitError,
  getEnterpriseOwnerClaimDetails,
} from '@/lib/billing/enterprise-owner-claim'
import { EnterpriseProvisioningError } from '@/lib/billing/enterprise-provisioning'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('EnterpriseOwnerClaimAPI')

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const parsed = await parseRequest(getEnterpriseOwnerClaimContract, request, context)
    if (!parsed.success) return parsed.response
    try {
      const details = await getEnterpriseOwnerClaimDetails({
        claimId: parsed.data.params.id,
        token: parsed.data.query.token,
        userId: session.user.id,
        userEmail: session.user.email,
      })
      if (!details) return NextResponse.json({ error: 'not-found' }, { status: 404 })
      return NextResponse.json(details)
    } catch (error) {
      if (error instanceof EnterpriseOwnerClaimEmailMismatchError) {
        return NextResponse.json(
          { error: 'email-mismatch', message: error.message },
          { status: 403 }
        )
      }
      if (error instanceof EnterpriseOwnerClaimWorkspaceLimitError) {
        return NextResponse.json(
          { error: 'workspace-limit', message: error.message },
          { status: 400 }
        )
      }
      if (error instanceof EnterpriseProvisioningError) {
        return NextResponse.json(
          { error: 'setup-blocked', message: error.message },
          { status: 400 }
        )
      }
      logger.error('Failed to load Enterprise owner claim', {
        claimId: parsed.data.params.id,
        error,
      })
      return NextResponse.json({ error: 'server-error' }, { status: 500 })
    }
  }
)
