import { withSSOProviderMutationLock } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ssoRegistrationContract } from '@/lib/api/contracts/auth'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import {
  assertSSOProviderAvailable,
  authorizeOrganizationSSO,
  buildSSOProviderConfiguration,
  collectAuthHeaders,
  requireNormalizedSSODomain,
  ssoManagementErrorResponse,
  validateSSOProviderId,
} from '@/lib/auth/sso/management'
import { env, isTruthy } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSORegisterRoute')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const parsed = await parseRequest(
      ssoRegistrationContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    await authorizeOrganizationSSO(session.user.id, body.orgId)
    validateSSOProviderId(body.providerId)
    const domain = requireNormalizedSSODomain(body.domain)
    await assertSSOProviderAvailable({
      providerId: body.providerId,
      domain,
      organizationId: body.orgId,
    })

    const providerConfig = await buildSSOProviderConfiguration(
      { ...body, domain },
      {
        providerId: body.providerId,
        organizationId: body.orgId,
      }
    )
    const registration = await withSSOProviderMutationLock(async () => {
      await assertSSOProviderAvailable({
        providerId: body.providerId,
        domain,
        organizationId: body.orgId,
      })
      return auth.api.registerSSOProvider({
        body: providerConfig,
        headers: collectAuthHeaders(request),
      })
    })

    logger.info('SSO provider registered', {
      providerId: body.providerId,
      providerType: body.providerType,
      domain,
      organizationId: body.orgId,
    })

    return NextResponse.json({
      success: true,
      providerId: registration.providerId,
      providerType: body.providerType,
      domainVerified: isTruthy(env.SSO_DOMAIN_VERIFICATION_ENABLED)
        ? registration.domainVerified
        : true,
      message: `${body.providerType.toUpperCase()} provider registered successfully`,
    })
  } catch (error) {
    const managedResponse = ssoManagementErrorResponse(error)
    if (managedResponse) return managedResponse

    logger.error('Failed to register SSO provider', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return NextResponse.json({ error: 'Failed to register SSO provider' }, { status: 500 })
  }
})
