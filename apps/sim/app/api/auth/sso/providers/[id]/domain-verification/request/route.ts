import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requestSsoDomainVerificationContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import {
  collectAuthHeaders,
  getDomainVerificationRecordName,
  getDomainVerificationRecordValue,
  getManagedSSOProvider,
  ssoManagementErrorResponse,
} from '@/lib/auth/sso/management'
import { env, isTruthy } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSODomainVerificationRequestRoute')

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

    const parsed = await parseRequest(requestSsoDomainVerificationContract, request, context)
    if (!parsed.success) return parsed.response

    const provider = await getManagedSSOProvider(parsed.data.params.id, session.user.id, {
      requireCreator: true,
    })
    const result = await auth.api.requestDomainVerification({
      body: { providerId: provider.providerId },
      headers: collectAuthHeaders(request),
    })

    return NextResponse.json(
      {
        recordName: getDomainVerificationRecordName(provider.providerId, provider.domain),
        recordValue: getDomainVerificationRecordValue(
          provider.providerId,
          result.domainVerificationToken
        ),
      },
      { status: 201 }
    )
  } catch (error) {
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse
    logger.error('Failed to request SSO domain verification', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json(
      { error: 'Failed to request SSO domain verification' },
      { status: 500 }
    )
  }
})
