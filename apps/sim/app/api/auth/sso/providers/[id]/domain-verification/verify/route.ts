import { withSSOProviderMutationLock } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { verifySsoDomainContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import {
  collectAuthHeaders,
  getManagedSSOProvider,
  ssoManagementErrorResponse,
} from '@/lib/auth/sso/management'
import { env, isTruthy } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSODomainVerificationRoute')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }
    if (!isTruthy(env.SSO_DOMAIN_VERIFICATION_ENABLED)) {
      return NextResponse.json({ error: 'SSO domain verification is not enabled' }, { status: 404 })
    }
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(verifySsoDomainContract, request, context)
    if (!parsed.success) return parsed.response

    await withSSOProviderMutationLock(async () => {
      const provider = await getManagedSSOProvider(parsed.data.params.id, session.user.id, {
        requireCreator: true,
      })
      return auth.api.verifyDomain({
        body: { providerId: provider.providerId },
        headers: collectAuthHeaders(request),
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse
    logger.error('Failed to verify SSO domain', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Failed to verify SSO domain' }, { status: 500 })
  }
})
